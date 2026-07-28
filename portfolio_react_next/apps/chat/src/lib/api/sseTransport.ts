import { ChatApiError, messageText, type ChatApi, type ReplyEvent } from '@chat/chat-domain';

/**
 * 실서버 SSE 전송(STEP 12 실증). mock 의 streamReply 와 같은 계약
 * (AsyncGenerator<ReplyEvent>)을 만족하되, 응답 텍스트 생성과 증분 전달을 실제 네트워크 경계
 * 너머(route handler POST /api/reply)로 옮긴다. 소비 측(ChatRoom.runReply, MessageList)은
 * 이 전송으로 바꿔도 한 줄도 바뀌지 않는다 - 이 파일과 chatApi 의 배선만 다르다.
 *
 * 상태(마지막 사용자 입력, 응답 일련번호, 완결 시 영속)는 mock 의 공개 원시를 그대로 재사용한다:
 *  - getChatRoom  : 없는 방이면 NOT_FOUND(재사용).
 *  - listMessages : 마지막 사용자 입력을 서버로 넘길 재료.
 *  - getReplySeq  : streamReply 와 같은 선택 지표 -> 재생성 의미론 일치.
 *  - appendAssistantReply : 서버가 완결한 텍스트를 클라이언트 영속으로 굳힌다(새로고침 후에도 유지).
 */

/** SSE data 페이로드의 형태. route handler 가 보내는 두 가지 이벤트. */
export interface SseReplyData {
  type: 'delta' | 'done';
  text: string;
}

/**
 * 누적 버퍼에서 완성된 SSE 이벤트를 뽑아 파싱하고, 미완성 꼬리는 rest 로 돌려준다(순수 함수).
 *
 * 스트림 파싱의 까다로운 지점을 이 함수에 격리해 fetch/DOM 없이 테스트한다:
 *  - 이벤트가 read 두 번에 걸쳐 쪼개지는 바이트 경계 -> 미완성분은 rest 에 남겨 다음 호출에서 완성.
 *  - 한 청크에 여러 이벤트 -> 루프로 모두 소비.
 *  - CRLF 개행 -> \n 으로 정규화(SSE 스펙 허용).
 *  - 손상된 JSON / 예상 밖 형태 -> ChatApiError('REPLY_FAILED') 로 던진다. 이것이 핵심 수정이다:
 *    생 SyntaxError 로 새어 나가면 isTransportFailure 가 이를 "전송 실패" 로 오분류해 네트워크
 *    품질 배너를 오점등시킨다(서버 프로토콜 버그가 회선 문제로 둔갑). 도메인 오류로 못박는다.
 */
export function parseSseEvents(buffer: string): { events: SseReplyData[]; rest: string } {
  const events: SseReplyData[] = [];
  let rest = buffer.replace(/\r\n/g, '\n'); // CRLF 정규화(재적용에 멱등)
  let boundary = rest.indexOf('\n\n');
  while (boundary !== -1) {
    const rawEvent = rest.slice(0, boundary);
    rest = rest.slice(boundary + 2);
    const dataLine = rawEvent.split('\n').find((line) => line.startsWith('data:'));
    if (dataLine) {
      events.push(parseDataPayload(dataLine.slice(5).trim()));
    }
    // 'data:' 없는 이벤트(주석 ':...', 'event:' 등)는 무시한다 - 이 프로토콜은 data 만 쓴다.
    boundary = rest.indexOf('\n\n');
  }
  return { events, rest };
}

function parseDataPayload(payload: string): SseReplyData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new ChatApiError('REPLY_FAILED', `SSE 이벤트 파싱 실패: ${payload.slice(0, 80)}`);
  }
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    'type' in parsed &&
    'text' in parsed &&
    ((parsed as { type: unknown }).type === 'delta' ||
      (parsed as { type: unknown }).type === 'done') &&
    typeof (parsed as { text: unknown }).text === 'string'
  ) {
    return { type: (parsed as SseReplyData).type, text: (parsed as SseReplyData).text };
  }
  throw new ChatApiError('REPLY_FAILED', 'SSE 이벤트 형식이 올바르지 않습니다.');
}

/** 재시도 가능한 일시적 전송 실패(회선 끊김/불완전 스트림/5xx). 도메인 오류와 구분한다. */
class TransientTransportError extends Error {}

export interface SseTransportOptions {
  signal?: AbortSignal;
  /** 일시 실패 시 재시도 횟수(기본 2 = 최초 1 + 재시도 2). 도메인/4xx/중단은 재시도하지 않는다. */
  maxRetries?: number;
  /** 재시도 전 대기(ms). 기본 지수 백오프(300/2^n, 상한 2s). 테스트는 0 주입. */
  backoffMs?: (attempt: number) => number;
  /** 주입용(테스트). 기본 전역 fetch. */
  fetchImpl?: typeof fetch;
}

const defaultBackoff = (attempt: number) => Math.min(2000, 300 * 2 ** attempt);

/** ms 대기하되 중단되면 즉시 거절(백오프도 중단에 반응하게). */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

export async function* sseStreamReply(
  raw: ChatApi,
  chatId: string,
  options?: SseTransportOptions,
): AsyncGenerator<ReplyEvent> {
  const signal = options?.signal;
  const maxRetries = options?.maxRetries ?? 2;
  const backoffMs = options?.backoffMs ?? defaultBackoff;
  const fetchImpl = options?.fetchImpl ?? fetch;

  // --- 프리플라이트(재시도 대상 아님: 도메인/상태 오류는 회선 문제가 아니다) ---
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new ChatApiError('NETWORK_OFFLINE', '네트워크에 연결되어 있지 않습니다.');
  }
  // 세 읽기는 서로 독립적이라 병렬로 받는다(직렬 3회 = mock read 지연 3배 -> 첫 토큰 전 대기).
  // getChatRoom 은 삭제된 방 가드(없으면 NOT_FOUND) - Promise.all 이 그 거절을 먼저 전파한다.
  const [, page, seq] = await Promise.all([
    raw.getChatRoom(chatId),
    raw.listMessages({ chatId }),
    raw.getReplySeq(chatId),
  ]);
  const lastUser = [...page.items].reverse().find((m) => m.role === 'user');
  const text = lastUser ? messageText(lastUser) : '';
  if (text.includes('/error')) {
    throw new ChatApiError('REPLY_FAILED', '응답 생성에 실패했습니다. (데모용 트리거)');
  }

  // --- 자동 재연결 + 이어받기 ---
  // 이미 소비자에게 보낸 텍스트 길이를 기억한다. 재연결하면 서버는 seq 기반으로 같은 응답을
  // 결정적으로 재생하므로, 그 재생본에서 "이미 보낸 접두"를 넘긴 부분만 이어서 내보낸다
  // (Last-Event-ID 없이도 중복 없는 재개 - mock 서버의 결정성을 활용).
  let emitted = '';

  for (let attempt = 0; ; attempt++) {
    try {
      yield* streamOnce(fetchImpl, { text, seq }, signal, raw, chatId, emitted, (grown) => {
        emitted = grown;
      });
      return; // done 도달
    } catch (err) {
      // 중단/도메인 오류(4xx/프로토콜)는 회선 문제가 아니므로 재시도하지 않는다.
      // 그 밖(회선 끊김 TypeError, 불완전 스트림 TransientTransportError, 5xx 등)은 재시도 대상.
      if (signal?.aborted || err instanceof ChatApiError) {
        throw err;
      }
      if (attempt >= maxRetries) {
        throw new ChatApiError('REPLY_FAILED', '응답 생성에 실패했습니다. (재시도 초과)');
      }
      await delay(backoffMs(attempt), signal); // 지수 백오프(중단 반응)
      // 루프 재시도 - emitted 를 보존해 이어받는다
    }
  }
}

/**
 * 한 번의 연결 시도. 이번 시도의 누적 텍스트가 emitted 를 넘어서는 부분만 yield 한다(중복 제거).
 * 완결('done') 이면 영속 후 done 이벤트를 내고 정상 종료, 그 전에 끊기면 TransientTransportError.
 */
async function* streamOnce(
  fetchImpl: typeof fetch,
  body: { text: string; seq: number },
  signal: AbortSignal | undefined,
  raw: ChatApi,
  chatId: string,
  emitted: string,
  onEmit: (grown: string) => void,
): AsyncGenerator<ReplyEvent> {
  const response = await fetchImpl('/api/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  // 4xx 는 요청 자체가 틀린 것(재시도 무의미) -> 도메인 오류. 그 외 비정상(5xx/본문없음)은 일시 실패.
  if (!response.ok || !response.body) {
    if (response.status >= 400 && response.status < 500) {
      throw new ChatApiError('REPLY_FAILED', '응답 생성에 실패했습니다.');
    }
    throw new TransientTransportError('non-ok response');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let accum = ''; // 이번 시도가 재생한 누적 텍스트
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { events, rest } = parseSseEvents(buffer);
      buffer = rest;
      for (const event of events) {
        if (event.type === 'delta') {
          accum += event.text;
          if (accum.length > emitted.length) {
            const suffix = accum.slice(emitted.length); // 이미 보낸 접두는 건너뛴다
            emitted = accum;
            onEmit(emitted);
            yield { type: 'delta', text: suffix };
          }
        } else {
          const message = await raw.appendAssistantReply(chatId, event.text);
          yield { type: 'done', message };
          return;
        }
      }
    }
    // done 없이 스트림이 끝났다 = 불완전 -> 재시도 대상
    throw new TransientTransportError('incomplete stream');
  } finally {
    reader.cancel().catch(() => {});
  }
}

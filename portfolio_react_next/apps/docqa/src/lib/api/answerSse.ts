import type { Answer, AnswerEvent } from '@chat/search-domain';

/**
 * 실서버 SSE 전송. mock 의 streamAnswer 와 같은 계약(AsyncGenerator<AnswerEvent>)을 만족하되,
 * 검색·추출·증분 전달을 실제 네트워크 경계 너머(route handler POST /api/answer)로 옮긴다.
 * 화면 코드(QaPage)는 이 전송으로 바꿔도 한 줄도 바뀌지 않는다 - 이 파일과 docqa.ts 의 배선만 다르다.
 */

/** 서버가 보낸 페이로드가 프로토콜에 어긋남(재시도해도 같은 결과 - 회선 문제와 구분). */
export class AnswerProtocolError extends Error {}

/**
 * 누적 버퍼에서 완성된 SSE 이벤트를 뽑아 파싱하고, 미완성 꼬리는 rest 로 돌려준다(순수 함수).
 * fetch/DOM 없이 프로토콜 엣지를 테스트하려고 스트림 읽기와 분리했다:
 *  - 이벤트가 read 두 번에 걸쳐 쪼개지는 바이트 경계 -> 미완성분은 rest 에 남겨 다음 호출에서 완성.
 *  - 한 청크에 여러 이벤트 -> 루프로 모두 소비.  - CRLF 개행 -> \n 정규화(SSE 스펙 허용).
 *  - 손상/형식위반 페이로드 -> AnswerProtocolError(회선 실패로 오분류하지 않는다).
 */
export function parseAnswerSseEvents(buffer: string): { events: AnswerEvent[]; rest: string } {
  const events: AnswerEvent[] = [];
  let rest = buffer.replace(/\r\n/g, '\n'); // CRLF 정규화(재적용에 멱등)
  let boundary = rest.indexOf('\n\n');
  while (boundary !== -1) {
    const rawEvent = rest.slice(0, boundary);
    rest = rest.slice(boundary + 2);
    const dataLine = rawEvent.split('\n').find((line) => line.startsWith('data:'));
    if (dataLine) events.push(parseDataPayload(dataLine.slice(5).trim()));
    // 'data:' 없는 이벤트(주석 ':...', 'event:' 등)는 무시한다 - 이 프로토콜은 data 만 쓴다.
    boundary = rest.indexOf('\n\n');
  }
  return { events, rest };
}

function parseDataPayload(payload: string): AnswerEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new AnswerProtocolError(`SSE 이벤트 파싱 실패: ${payload.slice(0, 80)}`);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new AnswerProtocolError('SSE 이벤트 형식이 올바르지 않습니다.');
  }
  const event = parsed as { type?: unknown; text?: unknown; answer?: unknown };
  if (event.type === 'delta' && typeof event.text === 'string') {
    return { type: 'delta', text: event.text };
  }
  if (event.type === 'done' && (event.answer === null || isAnswer(event.answer))) {
    return { type: 'done', answer: event.answer as Answer | null };
  }
  throw new AnswerProtocolError('SSE 이벤트 형식이 올바르지 않습니다.');
}

/** done 페이로드의 근거가 화면이 기대하는 모든 필드를 갖췄는지(부분 응답으로 하이라이트가 깨지지 않게). */
function isAnswer(value: unknown): value is Answer {
  if (typeof value !== 'object' || value === null) return false;
  const a = value as Record<string, unknown>;
  return (
    typeof a.text === 'string' &&
    typeof a.passageId === 'string' &&
    typeof a.docId === 'string' &&
    typeof a.docTitle === 'string' &&
    typeof a.category === 'string' &&
    typeof a.passageText === 'string' &&
    typeof a.spanStart === 'number' &&
    typeof a.spanEnd === 'number' &&
    typeof a.confidence === 'number'
  );
}

export interface SseAnswerOptions {
  signal?: AbortSignal;
  /** 주입용(테스트). 기본 전역 fetch. */
  fetchImpl?: typeof fetch;
}

/** POST /api/answer 를 SSE 로 소비해 mock 과 동일한 이벤트 흐름을 낸다. 실패는 던져서 상위가 폴백한다. */
export async function* sseStreamAnswer(
  query: string,
  options?: SseAnswerOptions,
): AsyncGenerator<AnswerEvent> {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const response = await fetchImpl('/api/answer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
    signal: options?.signal,
  });
  // 4xx 는 요청 자체가 틀린 것(재시도 무의미) -> 프로토콜 오류. 그 외 비정상(5xx/본문없음)은 회선 실패로 본다.
  if (!response.ok || !response.body) {
    if (response.status >= 400 && response.status < 500) {
      throw new AnswerProtocolError(`서버가 요청을 거절했습니다(${response.status}).`);
    }
    throw new Error(`SSE 응답이 올바르지 않습니다(${response.status}).`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { events, rest } = parseAnswerSseEvents(buffer);
      buffer = rest;
      for (const event of events) {
        yield event;
        if (event.type === 'done') return;
      }
    }
    throw new Error('스트림이 done 없이 끝났습니다.'); // 불완전 -> 상위가 폴백
  } finally {
    reader.cancel().catch(() => {});
  }
}

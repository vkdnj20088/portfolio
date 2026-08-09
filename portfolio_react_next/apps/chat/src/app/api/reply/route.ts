import { pickReply } from '@chat/chat-domain';
import { problemResponse } from '@chat/ui';
import { checkRateLimit } from '@/lib/rateLimit';
import { isLlmMode, streamAnthropicReply } from '@/lib/server/anthropicReply';
import { findLlmSample, hasLlmSamples } from '@/lib/server/llmSamples';
import { replyCache, streamGeneration } from '@/lib/server/replyCache';

/**
 * 응답 스트리밍 엔드포인트(STEP 12 실증) - text/event-stream(SSE).
 *
 * 클라이언트가 마지막 사용자 입력과 방별 응답 일련번호를 보내면, 서버가 mock 과 동일한
 * 결정적 선택(pickReply)으로 문안을 골라 어절 단위 delta 로 흘리고 마지막에 done 을 낸다.
 * 텍스트 생성과 증분 전달이 실제 네트워크 경계 너머로 옮겨졌을 뿐, 소비 계약(ReplyEvent)은 같다.
 *
 * LLM 전송 모드: 서버 환경에 ANTHROPIC_API_KEY 가 있으면 pickReply 대신 실제 LLM 스트리밍으로
 * 답한다. 와이어 형태(delta/done SSE)는 동일해서 클라이언트는 어느 생성인지 구분하지 않는다.
 * 재요청·재연결은 결정성 캐시(replyCache)가 같은 답을 재생해 이어받기 의미론을 보존한다.
 * 키가 없으면(배포 기본) 이 분기는 존재하지 않는 것과 같다 - 배포 동작 무변경.
 */
export const dynamic = 'force-dynamic';

/**
 * 응답 모드 조회 - 화면(§0 문구)이 무엇을 말할지 결정하는 근거. 키는 서버 런타임 환경이라
 * 빌드 산출물로는 알 수 없으므로 클라이언트가 물어본다.
 *
 *   llm     로컬 키로 실시간 호출
 *   sampled 키는 없지만 커밋된 실제 LLM 응답이 있다(추천 질문에 한해 재생)
 *   mock    결정적 목업뿐
 */
export function GET(): Response {
  const mode = isLlmMode() ? 'llm' : hasLlmSamples() ? 'sampled' : 'mock';
  return Response.json({ mode });
}

interface ReplyRequest {
  text?: unknown;
  seq?: unknown;
}

const REPLY_BUDGET_MS = 2000; // mock 명세값과 동일한 총 소요 예산
/** 입력 상한 - 어떤 실제 메시지보다도 크게 두되 무상한은 막는다(경량 DoS 표면 차단). */
const MAX_TEXT_LENGTH = 4000;

export async function POST(req: Request): Promise<Response> {
  // 레이트리밋은 본문을 읽기 전에 판정한다 - 거절할 요청의 본문을 파싱하는 것은 막으려던
  // 비용을 그대로 치르는 일이다(본문 크기 상한도 아직 적용되지 않은 시점이다).
  const limit = checkRateLimit(req);
  if (!limit.allowed) {
    return problemResponse(
      429,
      'RATE_LIMITED',
      '요청이 너무 잦습니다',
      `연속 요청 한도를 넘었습니다. ${limit.retryAfterSeconds}초 후 다시 시도해 주세요.`,
      { instance: '/api/reply', retryAfterSeconds: limit.retryAfterSeconds },
    );
  }

  let body: ReplyRequest;
  try {
    body = (await req.json()) as ReplyRequest;
  } catch {
    return problemResponse(
      400,
      'INVALID',
      '본문 해석 실패',
      '요청 본문을 해석할 수 없습니다. JSON 형식을 확인해 주세요.',
      { instance: '/api/reply' },
    );
  }

  const text = typeof body.text === 'string' ? body.text : '';
  if (text.length > MAX_TEXT_LENGTH) {
    return problemResponse(
      413,
      'PAYLOAD_TOO_LARGE',
      '메시지 길이 초과',
      '메시지가 허용 길이를 넘었습니다.',
      { instance: '/api/reply' },
    );
  }
  const seq = typeof body.seq === 'number' && Number.isFinite(body.seq) ? body.seq : 0;

  if (isLlmMode()) {
    return llmResponse(text, seq, req.signal);
  }

  // 키가 없는 배포. 커밋된 실제 LLM 응답이 있는 질문이면 그것을 재생하고, 없으면 목업으로
  // 떨어진다. 어느 쪽이든 아래 스트리밍 코드가 같아서 소비 계약은 그대로다 - 재생본도
  // 어절 단위로 흐르므로 화면 거동이 목업과 다르지 않다.
  const sample = findLlmSample(text);
  const reply = sample ? sample.reply : pickReply(text, seq);
  const words = reply.split(' ');
  const gap = Math.max(1, Math.floor(REPLY_BUDGET_MS / Math.max(1, words.length)));
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      try {
        for (let i = 0; i < words.length; i++) {
          await delay(gap, req.signal); // 클라이언트가 끊으면 여기서 AbortError 로 빠져나온다
          send({ type: 'delta', text: (i > 0 ? ' ' : '') + words[i] });
        }
        send({ type: 'done', text: reply });
      } catch {
        // 중단(AbortError)이면 조용히 종료한다 - 소비 측은 중단을 오류로 보지 않는다.
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no', // nginx 등 프록시가 스트림을 버퍼링하지 않게(실배포 대비)
    },
  });
}

/**
 * LLM 전송 모드의 SSE 응답. 캐시 키는 mock 의 결정성 지표와 동일한 (seq, text) - mock 이
 * pickReply(text, seq) 로 같은 답을 재생하듯, 여기서는 캐시가 같은 답을 재생한다.
 *
 * 생성은 요청 수명과 분리되어 있어(replyCache) 클라이언트가 중단해도 완주한다. 이 응답
 * 스트림만 중단에 반응해 닫힌다 - 재연결한 요청은 같은 버퍼를 처음부터 재생받고, 접두 스킵은
 * 클라이언트(sseTransport)가 한다. mock 분기와 같은 헤더/이벤트 형태를 유지한다.
 */
function llmResponse(text: string, seq: number, signal: AbortSignal): Response {
  const generation = replyCache.getOrStart(`${seq}:${text}`, () => streamAnthropicReply(text));
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      try {
        for await (const event of streamGeneration(generation, signal)) {
          send(event);
        }
        // 생성 실패면 done 없이 닫힌다 - 클라이언트가 불완전 스트림으로 보고 재시도한다.
      } catch {
        // 중단(AbortError)이면 조용히 종료 - mock 분기와 같은 규약.
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}

/** 중단 가능한 지연. signal 이 abort 되면 타이머를 정리하고 AbortError 로 거부한다. */
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

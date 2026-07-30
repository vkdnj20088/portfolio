import { pickReply } from '@chat/chat-domain';
import { problemResponse } from '@chat/ui';

/**
 * 응답 스트리밍 엔드포인트(STEP 12 실증) - text/event-stream(SSE).
 *
 * 클라이언트가 마지막 사용자 입력과 방별 응답 일련번호를 보내면, 서버가 mock 과 동일한
 * 결정적 선택(pickReply)으로 문안을 골라 어절 단위 delta 로 흘리고 마지막에 done 을 낸다.
 * 텍스트 생성과 증분 전달이 실제 네트워크 경계 너머로 옮겨졌을 뿐, 소비 계약(ReplyEvent)은 같다.
 */
export const dynamic = 'force-dynamic';

interface ReplyRequest {
  text?: unknown;
  seq?: unknown;
}

const REPLY_BUDGET_MS = 2000; // mock 명세값과 동일한 총 소요 예산
/** 입력 상한 - 어떤 실제 메시지보다도 크게 두되 무상한은 막는다(경량 DoS 표면 차단). */
const MAX_TEXT_LENGTH = 4000;

export async function POST(req: Request): Promise<Response> {
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
  const reply = pickReply(text, seq);
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

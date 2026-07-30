import { ANSWER_STEP_MS, answerChunks, extractAnswer, CORPUS } from '@chat/search-domain';
import { problemResponse } from '@chat/ui';

/**
 * 근거 QA 스트리밍 엔드포인트 - text/event-stream(SSE).
 *
 * 검색·독해(추출)를 서버에서 수행하고 답변 어절을 delta 로 흘린 뒤, 마지막 done 에 근거(문단·span·인용)를
 * 통째로 실어 보낸다. 클라이언트의 소비 계약(AnswerEvent)은 인메모리 mock 과 완전히 같아서,
 * 화면 코드는 전송이 무엇인지 모른 채 동작한다 - 전송계층 seam 이 "형태"가 아니라 실제로 갈린 지점.
 *
 * §0: 실 LLM 호출 없음. 답변은 서버의 결정적 코퍼스 검색 + 추출이라 같은 질의는 늘 같은 결과다
 * (그 결정성 덕에 회선이 끊겨 mock 으로 폴백해도 이미 받은 접두를 건너뛰고 이어받을 수 있다).
 */
export const dynamic = 'force-dynamic';

interface AnswerRequest {
  query?: unknown;
  /**
   * 후속질문 컨텍스트(#D1) - 직전 답변의 출처 문서. 있으면 그 문서 안에서만 근거를 찾는다.
   * 측정에서 정확도를 올린 유일한 컨텍스트 장치다(질의어 확장은 재 보고 버렸다).
   */
  pinnedDocId?: unknown;
}

/** 입력 상한 - 어떤 실제 질문보다도 크게 두되 무상한은 막는다(경량 DoS 표면 차단). */
const MAX_QUERY_LENGTH = 500;
/** 본문 바이트 상한(질의 500자 + JSON 봉투 여유). Content-Length 로 먼저 거른다. */
const MAX_BODY_BYTES = 4096;

export async function POST(req: Request): Promise<Response> {
  // 본문을 읽기 "전에" 크기부터 거절한다. json() 으로 다 받아 놓고 길이를 재면 상한이 메모리를
  // 지켜주지 못한다(Route Handler 에는 기본 본문 제한이 없다).
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return problemResponse(413, 'PAYLOAD_TOO_LARGE', '본문 크기 초과',
      `요청 본문이 상한(${MAX_BODY_BYTES}바이트)을 넘었습니다.`, { instance: '/api/answer' });
  }

  let body: AnswerRequest;
  try {
    body = (await req.json()) as AnswerRequest;
  } catch {
    return problemResponse(400, 'INVALID', '본문 해석 실패',
      '요청 본문을 해석할 수 없습니다. JSON 형식을 확인해 주세요.', { instance: '/api/answer' });
  }

  const query = typeof body.query === 'string' ? body.query : '';
  if (query.length > MAX_QUERY_LENGTH) {
    return problemResponse(413, 'PAYLOAD_TOO_LARGE', '질의 길이 초과',
      `질의가 상한(${MAX_QUERY_LENGTH}자)을 넘었습니다.`, { instance: '/api/answer' });
  }

  // 문서 id 는 코퍼스에서 온 값이라 화이트리스트로 검증한다 - 임의 문자열을 그대로 넘기면
  // 검색 범위를 클라이언트가 정하는 셈이고, 존재하지 않는 id 는 조용히 "답 없음"이 된다.
  const pinnedRaw = typeof body.pinnedDocId === 'string' ? body.pinnedDocId : null;
  const pinnedDocId = pinnedRaw && CORPUS.some((d) => d.id === pinnedRaw) ? pinnedRaw : null;
  const answer = extractAnswer(query, pinnedDocId ? { pinnedDocId } : undefined);
  const chunks = answer ? answerChunks(answer.text) : [];
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      try {
        for (const chunk of chunks) {
          await delay(ANSWER_STEP_MS, req.signal); // 클라이언트가 끊으면 AbortError 로 빠져나온다
          send({ type: 'delta', text: chunk });
        }
        // 근거가 약하면 answer=null - 없는 답을 지어내지 않고 "정답 없음"을 그대로 내려보낸다.
        send({ type: 'done', answer });
      } catch {
        // 중단(AbortError)이면 조용히 종료한다 - 소비 측은 중단을 오류로 보지 않는다.
      } finally {
        // 클라이언트가 끊었으면 스트림이 이미 닫혀 close() 가 던진다. 중단은 정상 경로다.
        try {
          controller.close();
        } catch {
          /* 이미 닫힘 */
        }
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

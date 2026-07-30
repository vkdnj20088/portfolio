import { search } from './retrieval';
import { extractAnswer } from './mrc';
import type { Answer, AnswerEvent, ScoredPassage, SearchMode } from './types';

/**
 * 두 제품 표면의 단일 진입 포트. 챗의 chatApi 와 같은 "seam" - 지금은 인메모리 mock 이지만, 같은 계약을
 * 만족하는 실제 전송(예: /api/answer SSE)로 갈아끼울 수 있게 스트리밍은 async generator 로 뽑는다.
 */
export interface DocQaApi {
  /** B(시맨틱 검색): 랭킹된 문단 결과. */
  search(query: string, mode: SearchMode): ScoredPassage[];
  /** A(근거 QA): 추출형 단일 답변(근거 약하면 null). */
  answer(query: string): Answer | null;
  /** A의 스트리밍 - 답변 텍스트를 어절 단위로 흘리고 마지막에 근거 포함 done. 챗 ReplyEvent 와 동형. */
  streamAnswer(
    query: string,
    options?: { signal?: AbortSignal; stepMs?: number; pinnedDocId?: string | null },
  ): AsyncGenerator<AnswerEvent>;
}

/**
 * 답변 텍스트를 스트리밍 조각으로 자른다(공백을 유지한 어절 단위 - 이어붙이면 원문 그대로).
 * mock 과 실제 SSE 라우트가 "같은 함수"를 쓰기 때문에 두 전송의 조각 경계가 동일하다.
 * 덕분에 전송이 중간에 끊겨 mock 으로 폴백해도 이미 보낸 접두를 그대로 건너뛰고 이어받을 수 있다.
 */
export function answerChunks(text: string): string[] {
  return text.split(/(\s+)/).filter((c) => c.length > 0);
}

/**
 * 중단 가능한 지연. 성공 경로에서 리스너를 반드시 떼어낸다 - `{ once: true }` 는 발화했을 때만
 * 정리하므로, 한 시그널로 여러 번 기다리면(어절마다 한 번) 리스너가 어절 수만큼 쌓인다.
 */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('aborted', 'AbortError'));
    const onAbort = () => {
      clearTimeout(id);
      reject(new DOMException('aborted', 'AbortError'));
    };
    const id = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** 어절 하나를 흘리는 간격(ms). mock 과 SSE 라우트가 같은 값을 써 체감 속도가 전송과 무관하게 같다. */
export const ANSWER_STEP_MS = 45;

export function createDocQaApi(opts?: { stepMs?: number }): DocQaApi {
  const defaultStep = opts?.stepMs ?? ANSWER_STEP_MS;
  return {
    search: (query, mode) => search(query, mode),
    answer: (query) => extractAnswer(query),
    async *streamAnswer(query, options) {
      // 후속질문 컨텍스트(#D1)를 서버 경로와 동일하게 적용한다 - mock 과 SSE 가 같은 답을 내야
      // 전송계층 seam 이 성립한다(폴백이 다른 답을 내면 이어받기 자체가 거짓말이 된다).
      const pinned = options?.pinnedDocId ?? null;
      const ans = extractAnswer(query, pinned ? { pinnedDocId: pinned } : undefined);
      if (!ans) {
        yield { type: 'done', answer: null };
        return;
      }
      const step = options?.stepMs ?? defaultStep;
      for (const c of answerChunks(ans.text)) {
        await delay(step, options?.signal);
        yield { type: 'delta', text: c };
      }
      yield { type: 'done', answer: ans };
    },
  };
}

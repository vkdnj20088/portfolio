import {
  createDocQaApi,
  search as searchAll,
  type AnswerEvent,
  type ScoredPassage,
  type SearchMode,
} from '@chat/search-domain';
import { sseStreamAnswer } from './api/answerSse';

/**
 * 두 제품 표면이 공유하는 단일 진입점(seam).
 *
 * - 검색(B)은 인메모리 결정적 색인이라 왕복이 필요 없다 - 그대로 in-process 로 답한다.
 * - 답변(A)은 실제 네트워크(SSE, POST /api/answer)로 받는다. 소비 코드는 계약(AnswerEvent)만 알기에
 *   전송이 무엇인지 모른다. 회선/서버가 죽으면 같은 계약의 in-process mock 으로 자동 강등하되,
 *   양쪽 모두 같은 결정적 추출 + 같은 조각 경계(answerChunks)를 쓰므로 이미 흘린 접두를 건너뛰고
 *   이어받아 중복 없이 답이 완성된다. 어느 전송이 실제로 서빙했는지는 onTransport 로 관측에 노출한다.
 */
const mock = createDocQaApi();

export type Transport = 'sse' | 'mock';

export interface AskOptions {
  signal?: AbortSignal;
  /** 실제로 응답을 서빙한 전송(관측 배지용). 폴백이면 사유를 함께 준다. */
  onTransport?: (transport: Transport, note?: string) => void;
  /** 주입용(테스트). */
  fetchImpl?: typeof fetch;
  /** 폴백 mock 의 어절 간격(ms). 테스트에서 0 으로 줄인다. */
  stepMs?: number;
}

/** NEXT_PUBLIC_TRANSPORT=mock 이면 네트워크를 아예 타지 않는다(정적 호스팅 등에서의 도피구). */
const sseEnabled = process.env.NEXT_PUBLIC_TRANSPORT !== 'mock';

export const docqa = {
  search(query: string, mode: SearchMode, limit?: number): ScoredPassage[] {
    return limit === undefined ? mock.search(query, mode) : searchAll(query, mode, limit);
  },

  async *streamAnswer(query: string, options?: AskOptions): AsyncGenerator<AnswerEvent> {
    // 소비자에게 이미 보낸 텍스트. 폴백 시 이 접두를 건너뛰어 중복 delta 를 막는다.
    let emitted = '';

    if (sseEnabled) {
      try {
        let announced = false;
        for await (const event of sseStreamAnswer(query, {
          signal: options?.signal,
          fetchImpl: options?.fetchImpl,
        })) {
          if (!announced) {
            options?.onTransport?.('sse');
            announced = true;
          }
          if (event.type === 'delta') emitted += event.text;
          yield event;
        }
        return; // done 도달
      } catch (error) {
        // 사용자가 중단한 것은 실패가 아니다 - 폴백하지 않고 그대로 끝낸다.
        if (options?.signal?.aborted) throw error;
        options?.onTransport?.('mock', reasonOf(error));
      }
    } else {
      options?.onTransport?.('mock', '설정으로 비활성화됨');
    }

    let accumulated = '';
    for await (const event of mock.streamAnswer(query, {
      signal: options?.signal,
      stepMs: options?.stepMs,
    })) {
      if (event.type === 'delta') {
        accumulated += event.text;
        if (accumulated.length > emitted.length) {
          const suffix = accumulated.slice(emitted.length); // 이미 보낸 접두는 건너뛴다
          emitted = accumulated;
          yield { type: 'delta', text: suffix };
        }
      } else {
        yield event;
      }
    }
  },
};

function reasonOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '전송 실패';
}

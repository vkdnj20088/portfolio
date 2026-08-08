/**
 * LLM 전송 모드의 결정성 캐시(서버 전용).
 *
 * <h2>왜 캐시가 결정성 장치인가</h2>
 * mock 전송의 이어받기(sseTransport 의 "이미 보낸 접두 스킵")는 서버가 같은 (text, seq) 에
 * 항상 같은 답을 재생한다는 결정성 위에 서 있다. LLM 은 그 성질이 없으므로, 첫 생성 결과를
 * 키별로 붙잡아 두고 재요청·재연결에는 그 사본을 재생한다 - 생성은 비결정적이어도 재생은
 * 결정적이 되어, 이어받기 의미론이 두 전송 모드에서 동일해진다(loandoc 의 "LLM 결정성 장치 =
 * 캐시"와 같은 논리).
 *
 * <h2>생성과 읽기의 분리</h2>
 * 생성(ReplyGeneration)은 요청 수명과 분리해 완주시킨다. 클라이언트가 끊겨도(모바일 새로고침,
 * 회선 단절) 생성은 계속 버퍼를 채우고, 재연결한 요청은 같은 버퍼를 처음부터 다시 읽는다 -
 * 접두 스킵은 클라이언트 몫이라 서버는 항상 전체를 재생하면 된다. 진행 중 재연결이면 지금까지
 * 쌓인 부분을 즉시 쏟고 이후 증분을 이어 받는다.
 *
 * <h2>프로세스 내 상태의 한계 - 알고 쓴다</h2>
 * rateLimit 과 같은 전제다: EC2 한 대, standalone Next 한 프로세스라 모듈 스코프 Map 이 곧
 * 전체 상태다. 상한(LRU 근사)을 두어 방문자 수만큼 자라지 않게 한다. 어차피 배포는 무키라
 * 이 캐시 자체가 동작하지 않는다 - 이 코드는 로컬 키 실행에서만 산다.
 */

/** 캐시 항목 수 상한. 넘으면 오래된 것부터 버린다(rateLimit 의 삽입 순서 근사 LRU 와 동일). */
const MAX_CACHE_ENTRIES = 200;

/**
 * 진행 중이거나 완결된 응답 한 건의 버퍼. append/finish/fail 은 생성 측이, 읽기는
 * streamGeneration 이 맡는다. 대기(waitChange)는 변화(증분/완결/실패)마다 한 번 깨어난다.
 */
export class ReplyGeneration {
  text = '';
  done = false;
  failed = false;
  private waiters: (() => void)[] = [];

  append(chunk: string): void {
    if (!chunk) return;
    this.text += chunk;
    this.wake();
  }

  finish(): void {
    this.done = true;
    this.wake();
  }

  fail(): void {
    this.failed = true;
    this.wake();
  }

  private wake(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const resolve of waiters) resolve();
  }

  /** 다음 변화까지 대기. signal 이 끊기면 AbortError 로 거절한다(리더가 끊겨도 생성은 무관). */
  waitChange(signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException('aborted', 'AbortError'));
        return;
      }
      const onAbort = () => reject(new DOMException('aborted', 'AbortError'));
      this.waiters.push(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      });
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
}

/**
 * (text, seq) 키 -> 생성 버퍼. 같은 키의 두 번째 요청부터는 생성을 다시 돌리지 않고
 * 기존 버퍼를 재생한다(동시 요청도 생성 1회를 공유한다 - API 호출 중복 차단).
 */
export class ReplyCache {
  private entries = new Map<string, ReplyGeneration>();

  constructor(private readonly maxEntries: number = MAX_CACHE_ENTRIES) {}

  /**
   * 키의 버퍼를 얻는다. 없으면 produce 로 생성을 시작한다(요청 수명과 분리된 백그라운드).
   * 실패한 생성은 항목을 지워 다음 요청이 새로 시도하게 한다 - 실패를 캐시하면 일시 장애가
   * 그 질문의 영구 장애로 굳는다.
   */
  getOrStart(key: string, produce: () => AsyncIterable<string>): ReplyGeneration {
    const existing = this.entries.get(key);
    if (existing) {
      // 삽입 순서 근사 LRU - 재사용된 항목을 뒤로 보낸다.
      this.entries.delete(key);
      this.entries.set(key, existing);
      return existing;
    }
    const generation = new ReplyGeneration();
    this.entries.set(key, generation);
    this.trim();
    void this.run(key, generation, produce);
    return generation;
  }

  get size(): number {
    return this.entries.size;
  }

  private async run(
    key: string,
    generation: ReplyGeneration,
    produce: () => AsyncIterable<string>,
  ): Promise<void> {
    try {
      for await (const chunk of produce()) {
        generation.append(chunk);
      }
      // 빈 응답은 완결로 치지 않는다 - done 에 빈 텍스트가 실리면 클라이언트가 빈 assistant
      // 메시지를 영속하게 된다. 실패로 돌려 재시도(새 생성)에 맡긴다.
      if (generation.text.length === 0) throw new Error('empty reply');
      generation.finish();
    } catch {
      generation.fail();
      if (this.entries.get(key) === generation) this.entries.delete(key);
    }
  }

  private trim(): void {
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }
}

/** route handler 가 SSE 로 옮겨 적을 이벤트 - 기존 결정적 재생과 같은 형태(delta/done). */
export type GenerationEvent = { type: 'delta'; text: string } | { type: 'done'; text: string };

/**
 * 버퍼를 처음부터 읽어 delta 스트림으로 바꾼다. 완결이면 마지막에 done(전체 텍스트)을 낸다.
 * 생성이 실패하면 done 없이 끝난다 - 클라이언트(sseTransport)는 이를 불완전 스트림으로 보고
 * 백오프 재시도하며, 그 재시도가 캐시의 새 생성을 트리거한다(실패 항목은 지워져 있다).
 */
export async function* streamGeneration(
  generation: ReplyGeneration,
  signal?: AbortSignal,
): AsyncGenerator<GenerationEvent> {
  let sent = 0;
  for (;;) {
    if (generation.text.length > sent) {
      const chunk = generation.text.slice(sent);
      sent = generation.text.length;
      yield { type: 'delta', text: chunk };
      continue;
    }
    if (generation.done) {
      yield { type: 'done', text: generation.text };
      return;
    }
    if (generation.failed) return;
    await generation.waitChange(signal);
  }
}

/** route handler 용 프로세스 전역 캐시. 테스트는 ReplyCache 를 직접 만들어 쓴다. */
export const replyCache = new ReplyCache();

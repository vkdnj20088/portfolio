import { describe, expect, it } from 'vitest';
import { ReplyCache, ReplyGeneration, streamGeneration, type GenerationEvent } from './replyCache';

/**
 * LLM 결정성 캐시의 계약 검증. 실제 API 호출 없이 fake 스트림(AsyncIterable<string>)을
 * 주입한다 - CI 에서 이 파일이 내는 네트워크 요청은 0 이다.
 *
 * 지키려는 계약은 하나다: "생성은 비결정적이어도 재생은 결정적이다." 같은 키의 재요청·재연결·
 * 동시 요청이 전부 같은 텍스트를 받아야 mock 전송의 이어받기 의미론(접두 스킵)이 LLM 모드에서도
 * 성립한다.
 */

/** 밀리초 대기 - fake 스트림이 "생성 중" 상태를 만들도록 청크 사이에 끼운다. */
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

/** 청크 배열을 그대로 흘리는 fake 생성. 호출 횟수를 세어 캐시 공유를 검증한다. */
function fakeProducer(chunks: string[], opts?: { failAfter?: number; gapMs?: number }) {
  let calls = 0;
  const produce = async function* () {
    calls++;
    for (const [i, chunk] of chunks.entries()) {
      if (opts?.failAfter !== undefined && i >= opts.failAfter) throw new Error('boom');
      if (opts?.gapMs) await tick(opts.gapMs);
      yield chunk;
    }
    if (opts?.failAfter !== undefined && opts.failAfter >= chunks.length) {
      throw new Error('boom');
    }
  };
  return { produce, callCount: () => calls };
}

async function collect(gen: ReplyGeneration, signal?: AbortSignal): Promise<GenerationEvent[]> {
  const events: GenerationEvent[] = [];
  for await (const event of streamGeneration(gen, signal)) events.push(event);
  return events;
}

describe('ReplyCache + streamGeneration', () => {
  it('생성 하나를 delta 들과 done(전체 텍스트)으로 재생한다', async () => {
    const cache = new ReplyCache();
    const { produce } = fakeProducer(['안녕', '하세요', '!'], { gapMs: 1 });
    const events = await collect(cache.getOrStart('k', produce));

    const deltas = events.filter((e) => e.type === 'delta').map((e) => e.text);
    expect(deltas.join('')).toBe('안녕하세요!');
    expect(events.at(-1)).toEqual({ type: 'done', text: '안녕하세요!' });
  });

  it('완결 후 같은 키 재요청은 생성 없이 같은 텍스트를 재생한다(재요청 결정성)', async () => {
    const cache = new ReplyCache();
    const { produce, callCount } = fakeProducer(['첫 ', '생성']);
    await collect(cache.getOrStart('k', produce));

    const replay = await collect(cache.getOrStart('k', produce));
    expect(callCount()).toBe(1); // 두 번째 요청은 캐시 재생 - API 호출 없음
    expect(replay.at(-1)).toEqual({ type: 'done', text: '첫 생성' });
  });

  it('진행 중 합류한 두 번째 리더도 처음부터 전체 텍스트를 받는다(재연결 이어받기)', async () => {
    const cache = new ReplyCache();
    const { produce, callCount } = fakeProducer(['하나 ', '둘 ', '셋'], { gapMs: 5 });
    const first = collect(cache.getOrStart('k', produce));
    await tick(8); // 생성이 일부 진행된 시점에 재연결
    const second = collect(cache.getOrStart('k', produce));

    const [a, b] = await Promise.all([first, second]);
    expect(callCount()).toBe(1);
    expect(a.at(-1)).toEqual({ type: 'done', text: '하나 둘 셋' });
    // 재연결 리더도 전체를 재생받는다 - 접두 스킵은 클라이언트 몫이라 서버는 항상 전체를 준다.
    expect(
      b
        .filter((e) => e.type === 'delta')
        .map((e) => e.text)
        .join(''),
    ).toBe('하나 둘 셋');
    expect(b.at(-1)).toEqual({ type: 'done', text: '하나 둘 셋' });
  });

  it('리더 중단은 생성을 죽이지 않는다 - 재요청이 완주한 답을 그대로 받는다', async () => {
    const cache = new ReplyCache();
    const { produce, callCount } = fakeProducer(['천천히 ', '완주'], { gapMs: 5 });
    const controller = new AbortController();
    const aborted = collect(cache.getOrStart('k', produce), controller.signal);
    controller.abort(); // 첫 리더(요청)가 끊긴다

    await expect(aborted).rejects.toThrow(); // AbortError
    await tick(20); // 생성은 백그라운드에서 완주
    const replay = await collect(cache.getOrStart('k', produce));
    expect(callCount()).toBe(1);
    expect(replay.at(-1)).toEqual({ type: 'done', text: '천천히 완주' });
  });

  it('생성 실패는 done 없이 끝나고 항목이 지워져 다음 요청이 새로 생성한다', async () => {
    const cache = new ReplyCache();
    const { produce, callCount } = fakeProducer(['부분 ', '출력'], { failAfter: 1 });
    const events = await collect(cache.getOrStart('k', produce));

    // done 없는 종료 = 클라이언트(sseTransport)가 불완전 스트림으로 보고 재시도하는 신호.
    expect(events.every((e) => e.type === 'delta')).toBe(true);
    expect(cache.size).toBe(0); // 실패는 캐시되지 않는다

    const retry = await collect(cache.getOrStart('k', fakeProducer(['재시도 성공']).produce));
    expect(callCount()).toBe(1);
    expect(retry.at(-1)).toEqual({ type: 'done', text: '재시도 성공' });
  });

  it('빈 응답은 완결로 치지 않는다(빈 assistant 메시지 영속 차단)', async () => {
    const cache = new ReplyCache();
    const events = await collect(cache.getOrStart('k', fakeProducer([]).produce));
    expect(events).toEqual([]); // done 없음 -> 재시도 대상
    expect(cache.size).toBe(0);
  });

  it('항목 수 상한을 넘으면 오래된 것부터 버린다', async () => {
    const cache = new ReplyCache(2);
    await collect(cache.getOrStart('a', fakeProducer(['A']).produce));
    await collect(cache.getOrStart('b', fakeProducer(['B']).produce));
    await collect(cache.getOrStart('c', fakeProducer(['C']).produce));
    expect(cache.size).toBe(2);

    // 'a' 는 밀려났으므로 재요청 시 새 생성이 돈다.
    const { produce, callCount } = fakeProducer(['A2']);
    const replay = await collect(cache.getOrStart('a', produce));
    expect(callCount()).toBe(1);
    expect(replay.at(-1)).toEqual({ type: 'done', text: 'A2' });
  });
});

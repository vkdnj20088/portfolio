import { describe, expect, it } from 'vitest';
import { BURST_CAPACITY, REFILL_PER_SEC, clientKey, consume } from './rateLimit';

/*
 * 시각을 인자로 주므로 실제 시간을 기다리지 않고 결정적으로 검증한다.
 * (setTimeout 으로 충전을 기다리는 테스트는 느리고 CI 부하에 따라 흔들린다.)
 */
type Store = Parameters<typeof consume>[0];
const store = (): Store => new Map();

describe('consume - 토큰 버킷', () => {
  it('처음 보는 키는 가득 찬 버킷으로 시작한다 - 첫 방문자를 벌하지 않는다', () => {
    const s = store();
    const d = consume(s, 'a', 0);
    expect(d.allowed).toBe(true);
    expect(d.remaining).toBe(BURST_CAPACITY - 1);
  });

  it('버스트 용량만큼 연속 통과하고 그 다음이 거절된다', () => {
    const s = store();
    for (let i = 0; i < BURST_CAPACITY; i++) {
      expect(consume(s, 'a', 0).allowed).toBe(true);
    }
    expect(consume(s, 'a', 0).allowed).toBe(false);
  });

  it('거절은 Retry-After 를 1초 이상으로 준다 - 0 은 "지금 다시" 라서 거절이 반복된다', () => {
    const s = store();
    for (let i = 0; i < BURST_CAPACITY; i++) consume(s, 'a', 0);
    const d = consume(s, 'a', 0);
    expect(d.allowed).toBe(false);
    expect(d.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    // 5초에 1개 충전이면 토큰 1개까지 5초.
    expect(d.retryAfterSeconds).toBe(Math.ceil(1 / REFILL_PER_SEC));
  });

  it('시간이 지나면 충전된다', () => {
    const s = store();
    for (let i = 0; i < BURST_CAPACITY; i++) consume(s, 'a', 0);
    expect(consume(s, 'a', 0).allowed).toBe(false);
    // 토큰 1개가 차는 시간만큼 흐른 뒤에는 통과한다.
    const oneTokenMs = (1 / REFILL_PER_SEC) * 1000;
    expect(consume(s, 'a', oneTokenMs).allowed).toBe(true);
  });

  it('충전 상한은 용량이다 - 오래 쉬어도 그 이상 쌓이지 않는다', () => {
    const s = store();
    consume(s, 'a', 0);
    // 아주 오래 뒤(그러나 TTL 안)에 와도 버스트는 용량만큼만이다.
    let allowed = 0;
    for (let i = 0; i < BURST_CAPACITY + 5; i++) {
      if (consume(s, 'a', 60_000 + i).allowed) allowed++;
    }
    expect(allowed).toBe(BURST_CAPACITY);
  });

  it('키가 서로 독립이다 - 한 사람이 다 써도 다른 사람은 통과한다', () => {
    const s = store();
    for (let i = 0; i < BURST_CAPACITY; i++) consume(s, 'a', 0);
    expect(consume(s, 'a', 0).allowed).toBe(false);
    expect(consume(s, 'b', 0).allowed).toBe(true);
  });

  it('거절도 상태를 남긴다 - 남기지 않으면 다음 요청이 다시 가득 찬 버킷을 받는다', () => {
    const s = store();
    for (let i = 0; i < BURST_CAPACITY; i++) consume(s, 'a', 0);
    consume(s, 'a', 0); // 거절
    // 같은 시각에 또 요청해도 여전히 거절이어야 한다(초기화되지 않았다).
    expect(consume(s, 'a', 0).allowed).toBe(false);
  });

  it('시계가 뒤로 가도 토큰이 줄지 않는다 - NTP 보정이 차단으로 바뀌면 안 된다', () => {
    const s = store();
    consume(s, 'a', 10_000);
    const d = consume(s, 'a', 5_000); // 과거 시각
    expect(d.allowed).toBe(true);
    expect(d.remaining).toBe(BURST_CAPACITY - 2);
  });

  it('오래 조용한 버킷은 정리된다 - 메모리가 방문자 수만큼 자라지 않는다', () => {
    const s = store();
    consume(s, 'old', 0);
    expect(s.size).toBe(1);
    // TTL(10분)을 넘긴 시각에 다른 키가 들어오면 sweep 이 옛 항목을 지운다.
    consume(s, 'new', 11 * 60 * 1000);
    expect(s.has('old')).toBe(false);
    expect(s.has('new')).toBe(true);
  });
});

describe('clientKey - 엣지가 덮어쓴 XFF 를 쓴다', () => {
  const req = (headers: Record<string, string>) => new Request('http://x/api/reply', { headers });

  it('X-Forwarded-For 를 키로 쓴다', () => {
    expect(clientKey(req({ 'x-forwarded-for': '203.0.113.7' }))).toBe('203.0.113.7');
  });

  it('목록이면 첫 항목만 쓴다', () => {
    expect(clientKey(req({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }))).toBe('203.0.113.7');
  });

  it('헤더가 없으면(로컬 개발) 단일 키로 모은다 - 개발 중에도 한도가 재현돼야 한다', () => {
    expect(clientKey(req({}))).toBe('local');
  });

  it('빈 값도 로컬로 떨어진다 - 빈 문자열 키로 갈리지 않게', () => {
    expect(clientKey(req({ 'x-forwarded-for': '   ' }))).toBe('local');
  });
});

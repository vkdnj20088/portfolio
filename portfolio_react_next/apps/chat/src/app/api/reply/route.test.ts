import { afterEach, describe, expect, it, vi } from 'vitest';
import { pickReply } from '@chat/chat-domain';
import { resetRateLimit } from '@/lib/rateLimit';
import { GET, POST } from './route';

/**
 * 키 게이트와 무키 폴백의 회귀 방지. 배포는 무키가 기본이므로, 이 파일이 지키는 것은
 * "LLM 코드를 넣은 뒤에도 무키 동작이 이전과 같다" 는 사실이다. 실제 API 호출은 없다 -
 * 무키 경로는 pickReply 결정적 재생이고, GET 은 환경변수만 읽는다.
 */

afterEach(() => {
  vi.unstubAllEnvs();
  resetRateLimit();
});

describe('GET /api/reply (모드 노출)', () => {
  it('키가 없으면 mock 을 알린다', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    const res = GET();
    expect(await res.json()).toEqual({ mode: 'mock' });
  });

  it('키가 있으면 llm 을 알린다', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test-not-a-real-key');
    const res = GET();
    expect(await res.json()).toEqual({ mode: 'llm' });
  });
});

describe('POST /api/reply (무키 폴백)', () => {
  it('키가 없으면 기존 결정적 재생(pickReply)으로 delta/done 을 흘린다', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    const text = '테스트 코드는 어디부터 짜야 할까?';
    const res = await POST(
      new Request('http://localhost/api/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, seq: 0 }),
      }),
    );
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');

    const raw = await res.text();
    const events = raw
      .split('\n\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => JSON.parse(line.slice(5)) as { type: string; text: string });
    const done = events.at(-1);
    expect(done?.type).toBe('done');
    expect(done?.text).toBe(pickReply(text, 0)); // 무키 = 이전과 비트 단위로 같은 답
    expect(
      events
        .filter((e) => e.type === 'delta')
        .map((e) => e.text)
        .join(''),
    ).toBe(done?.text);
  }, 15000); // mock 재생은 실제 2초 예산으로 흐른다 - 여유를 둔다
});

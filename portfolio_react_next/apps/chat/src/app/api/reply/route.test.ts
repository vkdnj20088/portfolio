import { afterEach, describe, expect, it, vi } from 'vitest';
import { pickReply } from '@chat/chat-domain';
import { resetRateLimit } from '@/lib/rateLimit';
import { GET, POST } from './route';

/**
 * 키 게이트와 무키 폴백의 회귀 방지. 배포는 무키가 기본이므로, 이 파일이 지키는 것은
 * "LLM 코드를 넣은 뒤에도 무키 동작이 이전과 같다" 는 사실이다. 실제 API 호출은 없다 -
 * 무키 경로는 pickReply 결정적 재생 또는 커밋된 응답 재생이고, GET 은 환경변수만 읽는다.
 *
 * 재생 샘플은 모듈째 갈아끼운다. 커밋된 llm-samples.json 을 그대로 읽으면 이 파일의 판정이
 * 산출물의 현재 내용에 따라 뒤집힌다 - 샘플을 추가·삭제했다고 라우트 계약 테스트가 깨지는
 * 것은 신호가 아니라 잡음이다. 산출물 자체의 형태는 llmSamples.test.ts 가 따로 지킨다.
 */
const samples = vi.hoisted(() => new Map<string, string>());

vi.mock('@/lib/server/llmSamples', () => ({
  findLlmSample: (question: string) => {
    const reply = samples.get(question);
    return reply ? { question, reply, model: 'test-model', generatedAt: 'test' } : undefined;
  },
  hasLlmSamples: () => samples.size > 0,
}));

afterEach(() => {
  vi.unstubAllEnvs();
  resetRateLimit();
  samples.clear();
});

/** SSE 본문을 이벤트 배열로 되돌린다. */
async function readEvents(res: Response) {
  const raw = await res.text();
  return raw
    .split('\n\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => JSON.parse(line.slice(5)) as { type: string; text: string });
}

async function post(text: string, seq = 0) {
  return POST(
    new Request('http://localhost/api/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, seq }),
    }),
  );
}

describe('GET /api/reply (모드 노출)', () => {
  it('키도 샘플도 없으면 mock 을 알린다', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    const res = GET();
    expect(await res.json()).toEqual({ mode: 'mock' });
  });

  it('키는 없고 커밋된 응답이 있으면 sampled 를 알린다', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    samples.set('질문', '답');
    const res = GET();
    expect(await res.json()).toEqual({ mode: 'sampled' });
  });

  it('키가 있으면 샘플이 있어도 llm 을 알린다', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test-not-a-real-key');
    samples.set('질문', '답');
    const res = GET();
    expect(await res.json()).toEqual({ mode: 'llm' });
  });
});

describe('POST /api/reply (무키 폴백)', () => {
  it('커밋된 응답이 없는 입력은 기존 결정적 재생(pickReply)으로 흘린다', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    const text = '커밋된 응답이 없는 질문';
    const res = await post(text);
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');

    const events = await readEvents(res);
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

  it('커밋된 응답이 있는 입력은 그것을 같은 delta/done 계약으로 재생한다', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    const text = '테스트 코드는 어디부터 짜야 할까?';
    const reply = '실제 LLM 이 낸 답이다';
    samples.set(text, reply);

    const events = await readEvents(await post(text));
    const done = events.at(-1);
    expect(done?.type).toBe('done');
    expect(done?.text).toBe(reply);
    expect(done?.text).not.toBe(pickReply(text, 0)); // 목업이 아니라 재생본이다
    // 재생본도 어절 단위로 흐른다 - 화면 거동이 목업과 달라지지 않는 것이 이 설계의 전제다.
    expect(events.filter((e) => e.type === 'delta').length).toBe(reply.split(' ').length);
    expect(
      events
        .filter((e) => e.type === 'delta')
        .map((e) => e.text)
        .join(''),
    ).toBe(reply);
  }, 15000);
});

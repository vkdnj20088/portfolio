import { describe, expect, it, vi } from 'vitest';
import { GOLDSET } from './goldset';

/**
 * LLM 대조군의 계약.
 *
 * 커밋 파일(llm-baseline.json)은 키를 가진 사람이 생성하므로 CI 에서는 비어 있을 수 있다.
 * 그래서 "베이스라인이 있을 때 어떻게 채점하는가"는 모듈을 가짜 JSON 으로 갈아끼워 검증하고,
 * 실제 커밋 파일에 대해서는 형태와 **낡음 여부**만 본다 - 내용은 사람이 갱신하는 산출물이다.
 */
const FAKE_REPORT = {
  cases: 3,
  retrieval: {
    semantic: { n: 0, recall1: 0, recall3: 0, recall5: 0, mrr: 0 },
    keyword: { n: 0, recall1: 0, recall3: 0, recall5: 0, mrr: 0 },
  },
  answer: { n: 0, answered: 0, correct: 0, accuracy: 0 },
  abstention: { n: 0, abstained: 0, rate: 0, overAbstained: 0 },
  rows: [
    // 규칙은 맞혔고 LLM 은 틀렸다.
    {
      q: 'A',
      split: 'exact' as const,
      gold: 'P1',
      semanticRank: 1,
      keywordRank: 1,
      answered: 'P1',
      ok: true,
    },
    // 규칙은 과잉 침묵, LLM 은 맞혔다 - LLM 이 이기는 칸이 표에 남아야 한다.
    {
      q: 'B',
      split: 'paraphrase' as const,
      gold: 'P2',
      semanticRank: 2,
      keywordRank: null,
      answered: null,
      ok: false,
    },
    // 답이 없어야 하는 문항. 규칙은 침묵, LLM 은 지어냈다.
    {
      q: 'C',
      split: 'unanswerable' as const,
      gold: null,
      semanticRank: null,
      keywordRank: null,
      answered: null,
      ok: true,
    },
  ],
};

const FAKE_ARTIFACT = {
  model: 'claude-sonnet-5',
  generatedAt: '2026-08-10T00:00:00.000Z',
  mode: 'semantic',
  depth: 5,
  cases: [
    { q: 'A', answered: 'P9', raw: 'P9', candidates: ['P1'] },
    { q: 'B', answered: 'P2', raw: 'P2', candidates: ['P2'] },
    { q: 'C', answered: 'P7', raw: 'P7', candidates: ['P7'] },
  ],
};

async function load(artifact: unknown) {
  vi.resetModules();
  vi.doMock('./llm-baseline.json', () => ({ default: artifact }));
  vi.doMock('./goldset', () => ({
    GOLDSET: [
      { q: 'A', gold: 'P1', split: 'exact' },
      { q: 'B', gold: 'P2', split: 'paraphrase' },
      { q: 'C', gold: null, split: 'unanswerable' },
    ],
  }));
  return import('./llmBaseline');
}

describe('compareLlmBaseline', () => {
  it('두 경로를 같은 잣대로 채점한다', async () => {
    const { compareLlmBaseline } = await load(FAKE_ARTIFACT);
    const cmp = compareLlmBaseline(FAKE_REPORT);

    // 규칙: A 정답, B 과잉 침묵, C 올바른 침묵.
    expect(cmp.rule).toMatchObject({
      answered: 1,
      correct: 1,
      wrong: 0,
      overAbstained: 1,
      abstained: 1,
      hallucinated: 0,
    });
    // LLM: A 오답, B 정답, C 지어냄.
    expect(cmp.llm).toMatchObject({
      answered: 2,
      correct: 1,
      wrong: 1,
      overAbstained: 0,
      abstained: 0,
      hallucinated: 1,
    });
  });

  it('LLM 만 맞힌 문항을 숨기지 않는다', async () => {
    const { compareLlmBaseline } = await load(FAKE_ARTIFACT);
    const cmp = compareLlmBaseline(FAKE_REPORT);
    const byQ = new Map(cmp.rows.map((r) => [r.q, r]));
    expect(byQ.get('A')?.verdict).toBe('ruleOnly');
    expect(byQ.get('B')?.verdict).toBe('llmOnly');
    expect(byQ.get('C')?.verdict).toBe('ruleOnly');
    expect(cmp.disagreements).toBe(3);
  });

  it('부분 수집이면 덮인 문항만 대조한다 - 없는 문항을 침묵으로 세지 않는다', async () => {
    const { compareLlmBaseline } = await load({
      ...FAKE_ARTIFACT,
      cases: [FAKE_ARTIFACT.cases[0]],
    });
    const cmp = compareLlmBaseline(FAKE_REPORT);
    expect(cmp.covered).toBe(1);
    expect(cmp.cases).toBe(3);
    // B 를 LLM 의 침묵으로 셌다면 overAbstained 가 1이 된다. 그러면 안 된다.
    expect(cmp.llm.overAbstained).toBe(0);
    expect(cmp.llm.abstained).toBe(0);
  });

  it('수집 전이면 hasLlmBaseline 이 거짓 - 화면은 대조 대신 그 사실을 말한다', async () => {
    const { hasLlmBaseline, compareLlmBaseline } = await load({
      ...FAKE_ARTIFACT,
      cases: [],
    });
    expect(hasLlmBaseline()).toBe(false);
    expect(compareLlmBaseline(FAKE_REPORT).covered).toBe(0);
  });
});

describe('커밋된 산출물', () => {
  it('형태가 계약을 지킨다', async () => {
    vi.resetModules();
    vi.doUnmock('./llm-baseline.json');
    vi.doUnmock('./goldset');
    const committed = (await import('./llm-baseline.json')).default as Record<string, unknown>;
    expect(typeof committed.model).toBe('string');
    expect(typeof committed.generatedAt).toBe('string');
    expect(committed.mode).toBe('semantic');
    expect(typeof committed.depth).toBe('number');
    expect(Array.isArray(committed.cases)).toBe(true);
    for (const c of committed.cases as Record<string, unknown>[]) {
      expect(typeof c.q).toBe('string');
      expect(c.answered === null || typeof c.answered === 'string').toBe(true);
      expect(typeof c.raw).toBe('string');
      expect(Array.isArray(c.candidates)).toBe(true);
    }
  });

  it('질문이 골드셋에 실재한다 - 오타 한 글자면 영영 대조되지 않는다', async () => {
    vi.resetModules();
    vi.doUnmock('./llm-baseline.json');
    const committed = (await import('./llm-baseline.json')).default as { cases: { q: string }[] };
    const questions = new Set(GOLDSET.map((c) => c.q));
    for (const c of committed.cases) expect(questions.has(c.q)).toBe(true);
  });

  it('후보 구성이 지금 코퍼스와 일치한다 - 어긋나면 다른 문제를 푼 답이다', async () => {
    vi.resetModules();
    vi.doUnmock('./llm-baseline.json');
    vi.doUnmock('./goldset');
    const { staleCases } = await import('./llmBaseline');
    // 수집 전(빈 산출물)이면 자연히 0건이다. 수집 후 코퍼스를 고치면 여기서 걸린다.
    expect(staleCases()).toEqual([]);
  });
});

// 수집 스크립트(apps/docqa/scripts)와의 정합은 그 앱의 테스트가 본다 - 이 패키지는 노드 API 에
// 의존하지 않는다(파일을 읽어야 검사할 수 있는 성질이라 러너 환경이 갈린다).

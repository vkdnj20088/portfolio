import { describe, expect, it } from 'vitest';
import { DEFAULT_BUDGET } from '../budget';
import type { Span, TraceArtifact } from '../types';
import { agreementOf, fleissKappa, judgeTrust } from './agreement';
import { backIndex, originKey, proposeCase, validateOrigins } from './promote';
import { buildReport } from './report';
import { majority, scoreCase } from './rules';
import type { Check, EvalCase, Judgment, RunSummary, Variant } from './types';

function run(over: Partial<RunSummary> = {}): RunSummary {
  return {
    scenarioId: 'vpn-blocked',
    variantId: 'A',
    runIndex: 0,
    finalState: 'succeeded',
    answer: 'SEC-02-p1 에 따르면 VPN 을 써야 합니다.',
    spent: { steps: 2, toolCalls: 2, inputTokens: 100, outputTokens: 50, wallMs: 1000 },
    toolCalls: [
      { name: 'guard.evaluateIpPolicy', status: 'ok', outputDigest: 'aaaa', attempt: 1 },
      { name: 'docqa.answer', status: 'ok', outputDigest: 'bbbb', attempt: 1 },
    ],
    citedPassageIds: ['SEC-02-p1'],
    groundedPassageIds: ['SEC-02-p1', 'SEC-02-p2'],
    ...over,
  };
}

function evalCase(checks: Check[], over: Partial<EvalCase> = {}): EvalCase {
  return {
    id: 'case-1',
    scenarioId: 'vpn-blocked',
    title: '사외 접근이 막힌 이유',
    origin: { scenarioId: 'vpn-blocked', variantId: 'A', runIndex: 0, spanId: 'span-1' },
    checks,
    humanLabel: null,
    ...over,
  };
}

describe('규칙 채점 - structure', () => {
  it('최종 상태를 단언한다', () => {
    const c = evalCase([
      {
        id: 'k',
        kind: 'structure',
        label: '',
        assertion: { op: 'finalStateIs', state: 'refused' },
      },
    ]);
    expect(scoreCase(c, run(), DEFAULT_BUDGET, []).passed).toBe(false);
    expect(scoreCase(c, run({ finalState: 'refused' }), DEFAULT_BUDGET, []).passed).toBe(true);
  });

  it('도구 호출은 시도가 아니라 호출 단위로 센다 - 재시도가 기대를 흔들면 안 된다', () => {
    const c = evalCase([
      {
        id: 'k',
        kind: 'structure',
        label: '',
        assertion: { op: 'toolCalledAtLeast', tool: 'guard.evaluateIpPolicy', times: 1 },
      },
    ]);
    const retried = run({
      toolCalls: [
        { name: 'guard.evaluateIpPolicy', status: 'error', outputDigest: '', attempt: 1 },
        { name: 'guard.evaluateIpPolicy', status: 'ok', outputDigest: 'cc', attempt: 2 },
      ],
    });
    expect(scoreCase(c, retried, DEFAULT_BUDGET, []).passed).toBe(true);
  });

  it('예산 초과는 예산 안에서 끝났다는 단언을 깬다', () => {
    const c = evalCase([
      { id: 'k', kind: 'structure', label: '', assertion: { op: 'withinBudget' } },
    ]);
    expect(scoreCase(c, run({ finalState: 'exhausted' }), DEFAULT_BUDGET, []).passed).toBe(false);
  });

  it('assertion 이 빠진 structure 체크는 통과가 아니라 채점 불가다', () => {
    const c = evalCase([{ id: 'k', kind: 'structure', label: '' }]);
    const s = scoreCase(c, run(), DEFAULT_BUDGET, []);
    expect(s.results[0]!.outcome).toBe('unscored');
    expect(s.passed).toBe(false);
  });
});

describe('규칙 채점 - citation', () => {
  const c = evalCase([{ id: 'cite', kind: 'citation', label: '' }]);

  it('도구 출력에 없던 문단을 인용하면 잡는다 - 지어냄이 여기서 걸린다', () => {
    const bad = run({ citedPassageIds: ['SEC-02-p1', 'HR-99-p9'] });
    const s = scoreCase(c, bad, DEFAULT_BUDGET, []);
    expect(s.passed).toBe(false);
    expect(s.results[0]!.reason).toContain('HR-99-p9');
  });

  it('인용이 아예 없는 것은 위반이 아니다 - 근거 없음으로 끝낸 실행이 그렇다', () => {
    expect(scoreCase(c, run({ citedPassageIds: [] }), DEFAULT_BUDGET, []).passed).toBe(true);
  });
});

describe('규칙 채점 - judge', () => {
  const check: Check = { id: 'j', kind: 'judge', label: '', question: '답했는가' };
  const c = evalCase([check]);
  const vote = (rubricId: string, verdict: Judgment['verdict']): Judgment => ({
    caseId: 'case-1',
    checkId: 'j',
    variantId: 'A',
    runIndex: 0,
    rubricId,
    verdict,
    reason: `${rubricId} 사유`,
  });

  it('심판 표가 없으면 통과가 아니라 채점 불가다 - 수집 전이 만점으로 보이면 안 된다', () => {
    const s = scoreCase(c, run(), DEFAULT_BUDGET, []);
    expect(s.results[0]!.outcome).toBe('unscored');
    expect(s.passed).toBe(false);
  });

  it('다수결로 접되 갈렸다는 사실을 사유에 남긴다', () => {
    const votes = [vote('r1', 'pass'), vote('r2', 'pass'), vote('r3', 'fail')];
    const r = majority(check, votes);
    expect(r.outcome).toBe('pass');
    expect(r.reason).toContain('갈림');
  });

  it('다른 실행의 표를 끌어오지 않는다', () => {
    const other = { ...vote('r1', 'pass'), runIndex: 1 };
    expect(scoreCase(c, run(), DEFAULT_BUDGET, [other]).results[0]!.outcome).toBe('unscored');
  });
});

describe('심판 일치도', () => {
  const cell = (i: number, verdicts: Judgment['verdict'][]): Judgment[] =>
    verdicts.map((verdict, k) => ({
      caseId: `c${i}`,
      checkId: 'j',
      variantId: 'A',
      runIndex: 0,
      rubricId: `r${k}`,
      verdict,
      reason: '',
    }));

  it('완전 일치면 kappa 가 1이다', () => {
    const js = [...cell(0, ['pass', 'pass', 'pass']), ...cell(1, ['fail', 'fail', 'fail'])];
    const a = agreementOf(js);
    expect(a.simple).toBe(1);
    expect(a.kappa).toBeCloseTo(1, 10);
  });

  it('완전 불일치면 kappa 가 음수다', () => {
    const js = [...cell(0, ['pass', 'fail']), ...cell(1, ['pass', 'fail'])];
    expect(agreementOf(js).kappa).toBeLessThan(0);
  });

  it('한쪽으로 쏠리면 일치율이 높아도 kappa 가 무너진다 - 그래서 단독으로 쓰지 않는다', () => {
    const js = [
      ...[0, 1, 2, 3, 4, 5, 6, 7, 8].flatMap((i) => cell(i, ['pass', 'pass', 'pass'])),
      ...cell(9, ['pass', 'pass', 'fail']),
    ];
    const a = agreementOf(js);
    expect(a.simple).toBeCloseTo(0.9, 10);
    expect(a.kappa).toBeLessThan(0.1);
  });

  it('갈린 항목을 목록으로 남긴다 - 루브릭을 고칠 다음 작업이 된다', () => {
    const js = [...cell(0, ['pass', 'pass', 'fail']), ...cell(1, ['pass', 'pass', 'pass'])];
    expect(agreementOf(js).splits).toEqual([
      { caseId: 'c0', checkId: 'j', variantId: 'A', runIndex: 0 },
    ]);
  });

  it('평정자 수가 칸마다 다르면 kappa 는 정의되지 않는다', () => {
    expect(
      fleissKappa(
        [
          { key: 'a', verdicts: ['pass', 'pass'] },
          { key: 'b', verdicts: ['pass'] },
        ],
        ['pass', 'fail'],
      ),
    ).toBeNaN();
  });
});

describe('심판을 믿는 근거', () => {
  const judgment = (caseId: string, verdict: Judgment['verdict'], rubricId = 'r1'): Judgment => ({
    caseId,
    checkId: 'j',
    variantId: 'A',
    runIndex: 0,
    rubricId,
    verdict,
    reason: '',
  });

  it('사람 라벨과 대조해 심판 정확도를 낸다', () => {
    const t = judgeTrust(
      [
        { caseId: 'c1', variantId: 'A', runIndex: 0, humanLabel: true },
        { caseId: 'c2', variantId: 'A', runIndex: 0, humanLabel: false },
      ],
      [judgment('c1', 'pass'), judgment('c2', 'pass')],
      [],
    );
    expect(t.anchorCount).toBe(2);
    expect(t.anchorAccuracy).toBe(0.5);
  });

  it('라벨이 붙은 실행의 표만 본다 - 다른 회차의 판정을 끌어오지 않는다', () => {
    const other = { ...judgment('c1', 'pass'), runIndex: 2 };
    const t = judgeTrust(
      [{ caseId: 'c1', variantId: 'A', runIndex: 0, humanLabel: true }],
      [other],
      [],
    );
    expect(t.anchorCount).toBe(0);
    expect(t.anchorAccuracy).toBeNull();
  });

  it('앵커가 없으면 정확도를 지어내지 않는다', () => {
    expect(judgeTrust([], [], []).anchorAccuracy).toBeNull();
  });

  it('함정을 잡았는지 센다 - 못 잡는 심판은 쓸 수 없다', () => {
    const t = judgeTrust(
      [],
      [],
      [
        judgment('trap-1', 'fail', 'r1'),
        judgment('trap-1', 'fail', 'r2'),
        judgment('trap-2', 'pass', 'r1'),
        judgment('trap-2', 'pass', 'r2'),
      ],
    );
    expect(t.trapTotal).toBe(2);
    expect(t.trapCaught).toBe(1);
  });
});

describe('승격', () => {
  const spans: Span[] = [
    {
      spanId: 'span-run',
      parentSpanId: null,
      kind: 'run',
      name: '사외 접근이 막힌 이유',
      status: 'ok',
      startOffsetMs: 0,
      durationMs: 10,
      evalCaseId: null,
      attrs: {},
    },
    {
      spanId: 'span-tool',
      parentSpanId: 'span-run',
      kind: 'tool',
      name: 'guard.evaluateIpPolicy',
      status: 'ok',
      startOffsetMs: 0,
      durationMs: 5,
      evalCaseId: null,
      attrs: {},
    },
  ];
  const trace: TraceArtifact = {
    scenarioId: 'vpn-blocked',
    title: '사외 접근이 막힌 이유',
    taskPrompt: '',
    model: 'm',
    generatedAt: '',
    toolsetDigest: 'd',
    budget: DEFAULT_BUDGET,
    finalState: 'succeeded',
    summary: '',
    spans,
  };

  it('실행에서 체크 후보를 뽑되 고르는 것은 사람이다', () => {
    const c = proposeCase(trace, {
      caseId: 'case-x',
      variantId: 'A',
      runIndex: 0,
      spanId: 'span-run',
    });
    const kinds = c.checks.map((k) => k.kind);
    expect(kinds).toContain('structure');
    expect(kinds).toContain('citation');
    expect(kinds).toContain('judge');
    // 자동 승격이 아니라는 것이 스키마에도 남는다 - 사람 라벨은 비어 있다.
    expect(c.humanLabel).toBeNull();
  });

  it('진실원은 케이스의 origin 이고 역인덱스는 그것에서 나온다', () => {
    const c = proposeCase(trace, {
      caseId: 'case-x',
      variantId: 'A',
      runIndex: 0,
      spanId: 'span-tool',
    });
    expect(backIndex([c]).get(originKey(c.origin))).toBe('case-x');
  });

  it('끊긴 승격 링크는 오류가 아니라 낡음으로 분류한다 - 재수집마다 빨간불이 켜지면 진짜 오류가 묻힌다', () => {
    const bad = proposeCase(trace, {
      caseId: 'case-x',
      variantId: 'A',
      runIndex: 0,
      spanId: 'span-없음',
    });
    expect(validateOrigins([bad], [trace]).staleAnchors.join()).toContain('span');
    // 채점은 시나리오 단위로 붙으므로 링크가 끊긴 것은 오류가 아니다.
    expect(validateOrigins([bad], [trace]).errors).toEqual([]);
  });

  it('trace 의 evalCaseId 가 케이스와 어긋나면 잡는다', () => {
    const c = proposeCase(trace, {
      caseId: 'case-x',
      variantId: 'A',
      runIndex: 0,
      spanId: 'span-run',
    });
    const tampered: TraceArtifact = {
      ...trace,
      spans: spans.map((s) => (s.spanId === 'span-run' ? { ...s, evalCaseId: 'case-다름' } : s)),
    };
    expect(validateOrigins([c], [tampered]).errors.join()).toContain('evalCaseId');
    const consistent: TraceArtifact = {
      ...trace,
      spans: spans.map((s) => (s.spanId === 'span-run' ? { ...s, evalCaseId: 'case-x' } : s)),
    };
    expect(validateOrigins([c], [consistent]).errors).toEqual([]);
  });
});

describe('보고서 조립', () => {
  const variants: Variant[] = [
    {
      id: 'A',
      label: '기본',
      note: '',
      systemPromptDigest: 'a',
      toolsetDigest: 't',
      guardrails: [],
    },
    {
      id: 'B',
      label: '보수',
      note: '',
      systemPromptDigest: 'b',
      toolsetDigest: 't',
      guardrails: [],
    },
  ];
  const cases = [
    evalCase(
      [
        {
          id: 'k',
          kind: 'structure',
          label: '',
          assertion: { op: 'finalStateIs', state: 'succeeded' },
        },
      ],
      { id: 'case-1' },
    ),
  ];
  const runs: RunSummary[] = [
    run({ variantId: 'A', runIndex: 0 }),
    run({ variantId: 'A', runIndex: 1 }),
    run({ variantId: 'B', runIndex: 0, finalState: 'refused' }),
    run({ variantId: 'B', runIndex: 1, finalState: 'refused' }),
  ];

  it('통과율과 쌍을 만들고 판정까지 낸다', () => {
    const r = buildReport({
      cases,
      runs,
      variants,
      judgments: [],
      trapJudgments: [],
      budgets: new Map([['vpn-blocked', DEFAULT_BUDGET]]),
    });
    expect(r.passRate.A!.rate).toBe(1);
    expect(r.passRate.B!.rate).toBe(0);
    expect(r.pairs).toHaveLength(2);
    // 쌍이 둘뿐이라 유의에 필요한 6쌍에 못 미친다. 100%p 차이여도 판정 불가다.
    expect(r.verdict).toBe('insufficient');
  });

  it('수집 전이면 그 사실을 말한다', () => {
    const r = buildReport({
      cases,
      runs: [],
      variants,
      judgments: [],
      trapJudgments: [],
      budgets: new Map(),
    });
    expect(r.collected).toBe(false);
  });

  it('예산을 모르는 시나리오는 채점하지 않는다 - 모르는 것을 통과로 세지 않는다', () => {
    const r = buildReport({
      cases,
      runs,
      variants,
      judgments: [],
      trapJudgments: [],
      budgets: new Map(),
    });
    expect(r.scores).toHaveLength(0);
  });
});

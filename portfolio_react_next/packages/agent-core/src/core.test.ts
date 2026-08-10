import { describe, expect, it } from 'vitest';
import { backoffDelayMs } from './backoff';
import { DEFAULT_BUDGET, budgetPressure, checkBudget, rollUp } from './budget';
import { digest, stableStringify } from './digest';
import { createIdFactory, isCorrelationSafe } from './ids';
import { canTransition, isTerminal, transition } from './machine';
import { alwaysExpanded, buildTree, flatten } from './tree';
import type { Span } from './types';

function span(p: Partial<Span> & Pick<Span, 'spanId' | 'kind'>): Span {
  return {
    parentSpanId: null,
    name: p.spanId,
    status: 'ok',
    startOffsetMs: 0,
    durationMs: 0,
    evalCaseId: null,
    attrs: {},
    ...p,
  };
}

describe('digest', () => {
  it('키 순서가 달라도 같은 값이다 - 아니면 내용이 같은데 낡았다고 오탐한다', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
    expect(digest({ b: 1, a: 2 })).toBe(digest({ a: 2, b: 1 }));
  });

  it('배열 순서는 보존한다 - 도구 결과의 순위는 의미가 있다', () => {
    expect(digest([1, 2])).not.toBe(digest([2, 1]));
  });

  it('undefined 필드는 없는 것과 같다', () => {
    expect(digest({ a: 1, b: undefined })).toBe(digest({ a: 1 }));
  });
});

describe('상관 ID', () => {
  it('Spring CorrelationIdFilter 가 받는 형식으로 만든다', () => {
    // 저쪽은 [A-Za-z0-9-] 1~64자만 통과시키고 위반하면 헤더를 버린다. 버려지면 span 과
    // 서버 로그가 다른 ID 를 갖게 되어 이 데모의 연결 고리가 조용히 끊긴다.
    const ids = createIdFactory('scenario-1');
    for (let i = 0; i < 20; i++) {
      const traceId = ids.traceId();
      expect(traceId).toHaveLength(32);
      expect(isCorrelationSafe(traceId)).toBe(true);
    }
  });

  it('형식 검사가 실제로 거른다', () => {
    expect(isCorrelationSafe('abc-123')).toBe(true);
    expect(isCorrelationSafe('has space')).toBe(false);
    expect(isCorrelationSafe('개행\n주입')).toBe(false);
    expect(isCorrelationSafe('')).toBe(false);
    expect(isCorrelationSafe('x'.repeat(65))).toBe(false);
  });

  it('같은 시드면 같은 id 열이 나온다 - 재수집해도 diff 가 요동치지 않는다', () => {
    const a = createIdFactory('s');
    const b = createIdFactory('s');
    expect([a.traceId(), a.spanId()]).toEqual([b.traceId(), b.spanId()]);
  });
});

describe('백오프', () => {
  it('같은 (run, call, attempt)면 같은 대기 시간이다', () => {
    expect(backoffDelayMs('r1', 'c1', 1)).toBe(backoffDelayMs('r1', 'c1', 1));
  });

  it('지수로 늘고 상한에서 멈춘다', () => {
    const d1 = backoffDelayMs('r1', 'c1', 1);
    const d3 = backoffDelayMs('r1', 'c1', 3);
    expect(d3).toBeGreaterThan(d1);
    for (let attempt = 1; attempt <= 12; attempt++) {
      // 지터 상한(+20%)까지 감안한 천장.
      expect(backoffDelayMs('r1', 'c1', attempt)).toBeLessThanOrEqual(4000 * 1.2);
    }
  });

  it('호출이 다르면 지터가 달라진다 - 같은 순간에 몰리지 않는다', () => {
    const a = backoffDelayMs('r1', 'c1', 2);
    const b = backoffDelayMs('r1', 'c2', 2);
    expect(a).not.toBe(b);
  });
});

describe('상태기계', () => {
  it('종료 상태에서는 아무 데로도 못 간다', () => {
    for (const s of ['succeeded', 'refused', 'failed', 'exhausted', 'cancelled'] as const) {
      expect(isTerminal(s)).toBe(true);
      expect(canTransition(s, 'running')).toBe(false);
    }
  });

  it('승인 대기는 실행으로 돌아오거나 중단된다', () => {
    expect(canTransition('running', 'awaiting_approval')).toBe(true);
    expect(canTransition('awaiting_approval', 'running')).toBe(true);
    expect(canTransition('awaiting_approval', 'succeeded')).toBe(false);
  });

  it('불응답과 예산 초과는 실패와 별개의 종료다', () => {
    expect(canTransition('running', 'refused')).toBe(true);
    expect(canTransition('running', 'exhausted')).toBe(true);
    expect(canTransition('running', 'failed')).toBe(true);
  });

  it('규칙 위반은 조용히 넘어가지 않는다', () => {
    expect(() => transition('succeeded', 'running')).toThrow();
  });
});

describe('예산', () => {
  const spans: Span[] = [
    span({ spanId: 'run', kind: 'run', durationMs: 5000 }),
    span({
      spanId: 's1',
      kind: 'step',
      parentSpanId: 'run',
      attrs: { 'gen_ai.usage.input_tokens': 100, 'gen_ai.usage.output_tokens': 20 },
    }),
    span({ spanId: 't1', kind: 'tool', parentSpanId: 's1' }),
  ];

  it('리프에서 롤업한다 - 합계를 따로 저장하지 않으므로 어긋날 수 없다', () => {
    expect(rollUp(spans)).toEqual({
      steps: 1,
      toolCalls: 1,
      inputTokens: 100,
      outputTokens: 20,
      wallMs: 5000,
    });
  });

  it('한 축만 넘어도 hard 다', () => {
    const spent = { steps: 99, toolCalls: 0, inputTokens: 0, outputTokens: 0, wallMs: 0 };
    expect(checkBudget(spent, DEFAULT_BUDGET)).toBe('hard');
  });

  it('soft limit 는 사람 승인을 받으라는 신호지 실패가 아니다', () => {
    const spent = {
      steps: Math.ceil(DEFAULT_BUDGET.maxSteps * 0.8),
      toolCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      wallMs: 0,
    };
    expect(checkBudget(spent, DEFAULT_BUDGET)).toBe('soft');
  });

  it('가장 먼저 바닥나는 축을 알려준다', () => {
    const spent = { steps: 7, toolCalls: 1, inputTokens: 10, outputTokens: 0, wallMs: 0 };
    expect(budgetPressure(spent, DEFAULT_BUDGET).axis).toBe('스텝');
  });
});

describe('span 트리', () => {
  const spans: Span[] = [
    span({ spanId: 'run', kind: 'run', durationMs: 1000 }),
    span({ spanId: 's1', kind: 'step', parentSpanId: 'run', startOffsetMs: 0, durationMs: 600 }),
    span({
      spanId: 't1',
      kind: 'tool',
      parentSpanId: 's1',
      startOffsetMs: 100,
      durationMs: 200,
      status: 'error',
    }),
    span({ spanId: 't2', kind: 'tool', parentSpanId: 's1', startOffsetMs: 350, durationMs: 150 }),
  ];

  it('부모-자식과 깊이를 세운다', () => {
    const roots = buildTree(spans);
    expect(roots).toHaveLength(1);
    expect(flatten(roots).map((n) => [n.span.spanId, n.depth])).toEqual([
      ['run', 0],
      ['s1', 1],
      ['t1', 2],
      ['t2', 2],
    ]);
  });

  it('자기시간을 계산한다 - 모델이 느린지 도구가 느린지 갈려야 한다', () => {
    const flat = flatten(buildTree(spans));
    const s1 = flat.find((n) => n.span.spanId === 's1')!;
    expect(s1.selfMs).toBe(600 - 200 - 150);
  });

  it('시작 순서로 정렬한다 - 재시도가 뒤에 오게', () => {
    const shuffled = [spans[0]!, spans[3]!, spans[2]!, spans[1]!];
    expect(flatten(buildTree(shuffled)).map((n) => n.span.spanId)).toEqual([
      'run',
      's1',
      't1',
      't2',
    ]);
  });

  it('부모를 못 찾아도 버리지 않는다 - 빈 화면보다 이상한 화면이 낫다', () => {
    const orphan = [span({ spanId: 'x', kind: 'tool', parentSpanId: 'gone' })];
    expect(buildTree(orphan)).toHaveLength(1);
  });

  it('실패한 span 은 항상 펼친다', () => {
    expect(alwaysExpanded(spans[2]!)).toBe(true);
    expect(alwaysExpanded(spans[3]!)).toBe(false);
  });
});

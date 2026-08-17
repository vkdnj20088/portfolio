import { describe, expect, it } from 'vitest';
import { digest } from './digest';
import { checkStale, toolDigests, toolsetDigest, usedToolNames, verifyToolSpans } from './replay';
import type { Span, ToolDefinition, ToolResult, TraceArtifact } from './types';

const ctx = { correlationId: 'test' };

function tool(name: string, run: ToolDefinition['run'], over: Partial<ToolDefinition> = {}) {
  return {
    name,
    description: name,
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    timeoutMs: 1000,
    sideEffect: false,
    requiresApproval: false,
    fixtures: [],
    run,
    ...over,
  } satisfies ToolDefinition;
}

function toolSpan(over: Partial<Span['attrs']>, spanId = 't1'): Span {
  return {
    spanId,
    parentSpanId: 'step',
    kind: 'tool',
    name: 'demo.tool',
    status: 'ok',
    startOffsetMs: 0,
    durationMs: 10,
    evalCaseId: null,
    attrs: { 'tool.name': 'demo.tool', 'tool.input': { q: 'x' }, ...over },
  };
}

function trace(spans: Span[]): TraceArtifact {
  return {
    scenarioId: 's',
    title: 't',
    taskPrompt: 'p',
    model: 'm',
    generatedAt: '2026-01-01T00:00:00.000Z',
    toolsetDigest: 'committed',
    budget: {
      maxSteps: 1,
      maxToolCalls: 1,
      maxInputTokens: 1,
      maxOutputTokens: 1,
      maxWallMs: 1,
      softLimitRatio: 0.8,
    },
    finalState: 'succeeded',
    summary: '',
    spans,
  };
}

describe('도구 재실행 검증', () => {
  it('출력이 같으면 verified - 재생본이 지금도 참임을 증명한다', async () => {
    const out = { hit: 1 };
    const tools = new Map([
      ['demo.tool', tool('demo.tool', async () => ({ ok: true, value: out }))],
    ]);
    const spans = [toolSpan({ 'tool.output_digest': digest(out) })];
    const [v] = await verifyToolSpans(trace(spans), tools, ctx);
    expect(v!.verdict).toBe('verified');
  });

  it('부작용이 있는 도구는 아예 부르지 않는다', async () => {
    // 재생 검증은 화면을 열 때마다 돈다. 여기서 예약 도구를 다시 부르면 배포된 서버가
    // 방문자 수만큼 작업을 만들고, 승인 게이트를 재생 경로로 우회하게 된다.
    let called = false;
    const tools = new Map([
      [
        'demo.tool',
        tool(
          'demo.tool',
          async () => {
            called = true;
            return { ok: true, value: {} };
          },
          { sideEffect: true },
        ),
      ],
    ]);
    const [v] = await verifyToolSpans(trace([toolSpan({})]), tools, ctx);
    expect(called).toBe(false);
    expect(v!.verdict).toBe('unverified');
    expect(v!.detail).toContain('부작용');
  });

  it('출력이 달라지면 mismatch - 스키마는 그대로인데 동작이 바뀐 경우를 잡는다', async () => {
    const tools = new Map([
      ['demo.tool', tool('demo.tool', async () => ({ ok: true, value: { hit: 2 } }))],
    ]);
    const spans = [toolSpan({ 'tool.output_digest': digest({ hit: 1 }) })];
    const [v] = await verifyToolSpans(trace(spans), tools, ctx);
    expect(v!.verdict).toBe('mismatch');
  });

  it('도달 불가는 unverified 지 mismatch 가 아니다', async () => {
    // Spring 이 안 떠 있는 환경(CI, 로컬)에서 늘 일어나는 일이다. 이걸 mismatch 로 뭉뚱그리면
    // 화면이 "값이 달라졌다"고 거짓말을 한다.
    const failing: ToolResult = {
      ok: false,
      code: 'UNREACHABLE',
      message: '연결 거부',
      retryable: true,
    };
    const tools = new Map([['demo.tool', tool('demo.tool', async () => failing)]]);
    const [v] = await verifyToolSpans(trace([toolSpan({})]), tools, ctx);
    expect(v!.verdict).toBe('unverified');
    expect(v!.detail).toContain('UNREACHABLE');
  });

  it('주입된 실패는 재실행하지 않고 재현으로 본다', async () => {
    let called = false;
    const tools = new Map([
      [
        'demo.tool',
        tool('demo.tool', async () => {
          called = true;
          return { ok: true, value: {} };
        }),
      ],
    ]);
    const spans = [toolSpan({ 'tool.injected_failure': 'TIMEOUT' })];
    const [v] = await verifyToolSpans(trace(spans), tools, ctx);
    expect(v!.verdict).toBe('verified');
    expect(called).toBe(false);
  });

  it('도구가 사라졌으면 unverified', async () => {
    const [v] = await verifyToolSpans(trace([toolSpan({})]), new Map(), ctx);
    expect(v!.verdict).toBe('unverified');
  });

  it('예외를 던지는 도구도 화면을 깨뜨리지 않는다', async () => {
    const tools = new Map([
      [
        'demo.tool',
        tool('demo.tool', async () => {
          throw new Error('폭발');
        }),
      ],
    ]);
    const [v] = await verifyToolSpans(trace([toolSpan({})]), tools, ctx);
    expect(v!.verdict).toBe('unverified');
    expect(v!.detail).toContain('폭발');
  });

  it('step span 은 검증 대상이 아니다 - 모델 왕복은 재생이다', async () => {
    const step: Span = {
      spanId: 'step',
      parentSpanId: null,
      kind: 'step',
      name: 'step 1',
      status: 'ok',
      startOffsetMs: 0,
      durationMs: 1,
      evalCaseId: null,
      attrs: {},
    };
    expect(await verifyToolSpans(trace([step]), new Map(), ctx)).toEqual([]);
  });
});

describe('도구별 다이제스트와 낡음 판정', () => {
  const t1 = tool('a.one', async () => ({ ok: true, value: 1 }));
  const t2 = tool('b.two', async () => ({ ok: true, value: 2 }));
  const t3 = tool('c.three', async () => ({ ok: true, value: 3 }));

  /** a.one 만 쓴 실행. */
  const usedOne = trace([toolSpan({ 'tool.name': 'a.one' })]);

  it('쓰지 않은 도구가 늘어난 것으로는 낡지 않는다', () => {
    // 3단계에서 도구 둘을 늘렸다는 이유로 실행 서른 건과 판정 백스물여섯 건을 통째로 다시
    // 받았다. 낡음은 집합의 성질이 아니라 그 실행이 실제로 쓴 도구의 성질이다.
    const before = toolDigests([t1, t2]);
    const after = {
      toolsetDigest: toolsetDigest([t1, t2, t3]),
      toolDigests: toolDigests([t1, t2, t3]),
    };
    const r = checkStale({ ...usedOne, toolsetDigest: toolsetDigest([t1, t2]) }, after, before);
    expect(r.stale).toBe(false);
    expect(r.changed).toEqual([]);
    expect(r.coarse).toBe(false);
  });

  it('쓴 도구의 계약이 바뀌면 낡고, 무엇이 바뀌었는지 이름을 남긴다', () => {
    const before = toolDigests([t1, t2]);
    const changedTool = tool('a.one', async () => ({ ok: true, value: 1 }), {
      fixtures: ['새 픽스처'],
    });
    const after = {
      toolsetDigest: toolsetDigest([changedTool, t2]),
      toolDigests: toolDigests([changedTool, t2]),
    };
    const r = checkStale({ ...usedOne, toolsetDigest: toolsetDigest([t1, t2]) }, after, before);
    expect(r.stale).toBe(true);
    expect(r.changed).toEqual(['a.one']);
  });

  it('도구별 해시가 없는 옛 산출물은 집합 해시로 판정하되 거칠다고 표시한다', () => {
    // 판정을 거절하면 옛 산출물이 화면에서 사라진다. 떨어지되 감추지 않는다.
    const r = checkStale({ ...usedOne, toolsetDigest: 'old' }, 'new');
    expect(r.stale).toBe(true);
    expect(r.coarse).toBe(true);
  });

  it('집합 해시는 도구별 해시가 같으면 같다 - 둘이 어긋날 수 없다', () => {
    expect(toolsetDigest([t1, t2])).toBe(toolsetDigest([t2, t1]));
    expect(toolDigests([t1, t2])).toEqual(toolDigests([t2, t1]));
  });

  it('쓴 도구 이름은 재시도로 중복돼도 한 번만 센다', () => {
    const two = trace([
      toolSpan({ 'tool.name': 'a.one' }, 's1'),
      toolSpan({ 'tool.name': 'a.one' }, 's2'),
    ]);
    expect(usedToolNames(two)).toEqual(['a.one']);
  });
});

describe('도구 집합 다이제스트', () => {
  const a = tool('a', async () => ({ ok: true, value: 1 }));
  const b = tool('b', async () => ({ ok: true, value: 2 }));

  it('등록 순서가 달라도 같다', () => {
    expect(toolsetDigest([a, b])).toBe(toolsetDigest([b, a]));
  });

  it('스키마가 바뀌면 달라진다 - 커밋된 trace 가 낡았음을 알린다', () => {
    const changed = tool('a', a.run, { inputSchema: { type: 'string' } });
    expect(toolsetDigest([a, b])).not.toBe(toolsetDigest([changed, b]));
  });

  it('픽스처가 바뀌면 달라진다', () => {
    const changed = tool('a', a.run, { fixtures: ['새 픽스처'] });
    expect(toolsetDigest([a, b])).not.toBe(toolsetDigest([changed, b]));
  });

  it('구현만 바뀌면 못 잡는다 - 그 자리는 도구 재실행이 받는다', () => {
    const sameShape = tool('a', async () => ({ ok: true, value: 999 }));
    expect(toolsetDigest([a, b])).toBe(toolsetDigest([sameShape, b]));
  });

  it('낡음 판정이 커밋값과 현재값을 함께 돌려준다', () => {
    expect(checkStale(trace([]), 'different')).toEqual({
      stale: true,
      changed: [],
      coarse: true,
      committed: 'committed',
      current: 'different',
    });
    expect(checkStale(trace([]), 'committed').stale).toBe(false);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { digest, toolsetDigest } from '@chat/agent-core';
import { TOOLS, TOOL_BY_NAME } from './tools';
import { SCENARIOS } from './scenarios';
import { CURRENT_TOOLSET_DIGEST, hasTraces, staleReport, traceBundle } from './traces';

const ctx = { correlationId: 'a'.repeat(32) };

describe('도구 계약', () => {
  it('세 도구가 이름/스키마/타임아웃을 선언한다', () => {
    expect(TOOLS.map((t) => t.name).sort()).toEqual([
      'docqa.answer',
      'docqa.search',
      'guard.evaluateIpPolicy',
    ]);
    for (const t of TOOLS) {
      expect(t.inputSchema).toHaveProperty('type', 'object');
      expect(t.outputSchema).toHaveProperty('type', 'object');
      expect(t.timeoutMs).toBeGreaterThan(0);
    }
  });

  it('1단계 도구는 전부 부작용이 없다 - 읽기 전용으로 자른 경계다', () => {
    for (const t of TOOLS) {
      expect(t.sideEffect).toBe(false);
      expect(t.requiresApproval).toBe(false);
    }
  });

  it('잘못된 입력은 예외가 아니라 구조화 오류로 돌아온다', async () => {
    const r = await TOOL_BY_NAME.get('docqa.search')!.run({ query: '' }, ctx);
    expect(r).toMatchObject({ ok: false, code: 'BAD_INPUT', retryable: false });
  });

  it('docqa.search 는 결정적이다 - 같은 입력이면 같은 다이제스트', async () => {
    const tool = TOOL_BY_NAME.get('docqa.search')!;
    const a = await tool.run({ query: '재택근무' }, ctx);
    const b = await tool.run({ query: '재택근무' }, ctx);
    expect(a.ok && b.ok).toBe(true);
    expect(digest(a.ok && a.value)).toBe(digest(b.ok && b.value));
  });

  it('docqa.answer 는 근거가 없으면 answered=false 를 돌려준다 - 오류가 아니다', async () => {
    const tool = TOOL_BY_NAME.get('docqa.answer')!;
    const r = await tool.run({ question: '사내 주차장은 몇 시까지 운영하나요?' }, ctx);
    expect(r.ok).toBe(true);
    expect(r.ok && (r.value as { answered: boolean }).answered).toBe(false);
  });

  it('docqa.answer 는 근거가 있으면 문단 id 를 함께 돌려준다', async () => {
    const tool = TOOL_BY_NAME.get('docqa.answer')!;
    const r = await tool.run({ question: '연차는 며칠 부여되나요?' }, ctx);
    expect(r.ok).toBe(true);
    const v = r.ok ? (r.value as { answered: boolean; passageId: string | null }) : null;
    expect(v?.answered).toBe(true);
    expect(v?.passageId).toBeTruthy();
  });
});

describe('guard 도구의 상관 ID 전파', () => {
  const tool = TOOL_BY_NAME.get('guard.evaluateIpPolicy')!;

  it('X-Request-Id 헤더로 traceId 를 실어 보낸다', async () => {
    // Spring 의 CorrelationIdFilter 계약이다. 헤더 이름이 틀리면 저쪽이 자기 UUID 를 만들고,
    // span 과 서버 로그가 다른 ID 를 갖게 되어 연결이 조용히 끊긴다.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          decision: 'DENY',
          reason: '기본 정책',
          matchedRule: null,
          evaluatedRules: [],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    await tool.run({ target: '203.0.113.7' }, ctx);
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)['X-Request-Id']).toBe(ctx.correlationId);
    fetchSpy.mockRestore();
  });

  it('서버가 없으면 UNREACHABLE 이고 재시도 대상이다', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED'), { name: 'TypeError' }));
    const r = await tool.run({ target: '203.0.113.7' }, ctx);
    expect(r).toMatchObject({ ok: false, code: 'UNREACHABLE', retryable: true });
    fetchSpy.mockRestore();
  });

  it('5xx 는 재시도 대상, 4xx 는 아니다', async () => {
    const respond = (status: number) =>
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status }));
    let spy = respond(503);
    expect(await tool.run({ target: '1.1.1.1' }, ctx)).toMatchObject({ retryable: true });
    spy.mockRestore();
    spy = respond(400);
    expect(await tool.run({ target: '1.1.1.1' }, ctx)).toMatchObject({ retryable: false });
    spy.mockRestore();
  });
});

describe('시나리오', () => {
  it('상태 다섯이 실물로 있도록 다섯 개를 정의한다', () => {
    expect(SCENARIOS).toHaveLength(5);
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(5);
  });

  it('도구 실패 시나리오는 결정적 주입을 갖는다 - 재생에서도 같은 실패가 난다', () => {
    const retry = SCENARIOS.find((s) => s.id === 'tool-retry')!;
    expect(retry.injections).toHaveLength(1);
    expect(retry.injections[0]!.attempt).toBe(1);
    expect(TOOL_BY_NAME.has(retry.injections[0]!.tool)).toBe(true);
  });

  it('예산 시나리오는 상한을 일부러 낮게 잡는다', () => {
    const stop = SCENARIOS.find((s) => s.id === 'budget-stop')!;
    expect(stop.budget.maxSteps).toBeLessThan(8);
  });
});

describe('커밋된 산출물', () => {
  it('형태가 계약을 지킨다', () => {
    const b = traceBundle();
    expect(Array.isArray(b.traces)).toBe(true);
    expect(typeof b.toolsetDigest).toBe('string');
    for (const t of b.traces) {
      expect(typeof t.scenarioId).toBe('string');
      expect(Array.isArray(t.spans)).toBe(true);
    }
  });

  it('수집 전이면 화면이 그 사실을 말한다', () => {
    // 비어 있을 때 hasTraces 가 false 여야 "아직 수집 전" 분기가 뜬다.
    expect(hasTraces()).toBe(traceBundle().traces.length > 0);
  });

  it('도구 집합이 바뀌면 낡음으로 잡힌다', () => {
    const report = staleReport();
    if (report) expect(report.stale).toBe(false);
    // 수집 전에는 대조할 trace 가 없다.
    else expect(hasTraces()).toBe(false);
  });

  it('현재 다이제스트가 도구 정의에서 나온다', () => {
    expect(CURRENT_TOOLSET_DIGEST).toBe(toolsetDigest(TOOLS));
  });
});

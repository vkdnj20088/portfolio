import { describe, expect, it } from 'vitest';
import { checkStale, digest, rollUp, toolDigests } from '@chat/agent-core';
import { TOOLS } from '../tools';
import { CURRENT_TOOL_FINGERPRINT, staleReports } from '../traces';
import { SCENARIO_BY_ID } from '../scenarios';
import { traceBundle } from '../traces';
import { caseProblems, cases, hasRuns, judgmentBundle, report, runBundle } from './dataset';
import { PROMPT_BY_VARIANT, VARIANTS } from './variants';

describe('승격된 케이스', () => {
  it('가리키는 span 과 시나리오가 실재한다', () => {
    // 오타 난 origin 은 조용히 채점에서 빠져 통과율을 올린다. 화면이 수치를 보이기 전에
    // 이 목록이 비어 있어야 한다.
    expect(caseProblems().errors).toEqual([]);
  });

  it('모든 케이스가 아는 시나리오에 붙어 있다', () => {
    for (const c of cases()) expect(SCENARIO_BY_ID.has(c.scenarioId)).toBe(true);
  });

  it('체크 종류마다 필요한 필드가 채워져 있다', () => {
    for (const c of cases()) {
      for (const k of c.checks) {
        if (k.kind === 'structure') expect(k.assertion, `${c.id}/${k.id}`).toBeTruthy();
        if (k.kind === 'judge') expect(k.question, `${c.id}/${k.id}`).toBeTruthy();
      }
    }
  });

  it('케이스 id 가 겹치지 않는다', () => {
    const ids = cases().map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('사람 라벨이 붙은 케이스는 심판 체크를 갖는다 - 라벨은 심판을 재는 자다', () => {
    for (const c of cases()) {
      if (c.humanLabel === null) continue;
      expect(
        c.checks.some((k) => k.kind === 'judge'),
        c.id,
      ).toBe(true);
    }
  });

  it('함정 케이스는 실패가 정답이다', () => {
    for (const c of cases()) {
      if (c.trap) expect(c.trap.expected).toBe(false);
    }
  });
});

describe('구성 정의', () => {
  it('두 구성이 프롬프트만 다르다 - 도구집합이 같아야 대조가 성립한다', () => {
    const [a, b] = VARIANTS;
    expect(a!.toolsetDigest).toBe(b!.toolsetDigest);
    expect(a!.systemPromptDigest).not.toBe(b!.systemPromptDigest);
  });

  it('산출물의 해시가 지금 코드의 프롬프트에서 나온다', () => {
    // 프롬프트 원문의 진실원은 코드다. 수집 뒤에 문장을 고치면 이 테스트가 어긋나고,
    // 그 어긋남이 "이 표본은 다른 지시로 만들어졌다"는 사실을 알린다.
    for (const v of runBundle().variants) {
      const prompt = PROMPT_BY_VARIANT[v.id];
      if (!prompt) continue;
      expect(v.systemPromptDigest, v.id).toBe(digest(prompt));
    }
  });
});

describe('실행 요약과 span 원본', () => {
  it('요약이 원본과 어긋나지 않는다 - 미리 계산한 요약은 부패한다', () => {
    if (!hasRuns()) return;
    for (const trace of traceBundle().traces) {
      const summary = runBundle().runs.find(
        (r) => r.scenarioId === trace.scenarioId && r.variantId === 'A' && r.runIndex === 0,
      );
      expect(summary, trace.scenarioId).toBeTruthy();
      if (!summary) continue;
      expect(summary.finalState).toBe(trace.finalState);
      expect(summary.answer).toBe(trace.summary);
      expect(summary.spent).toEqual(rollUp(trace.spans));
      expect(summary.toolCalls.map((c) => c.name)).toEqual(
        trace.spans.filter((s) => s.kind === 'tool').map((s) => s.name),
      );
    }
  });

  it('인용한 문단은 도구 출력에 있던 것만 요약에 실린다고 주장하지 않는다', () => {
    // 여기서 검사하는 것은 요약의 정직성이다. citedPassageIds 는 답에서 그대로 긁어 온
    // 것이고, 그것이 grounded 밖인지 아닌지를 판정하는 것은 채점기의 몫이다. 수집 단계에서
    // 미리 걸러 버리면 지어낸 인용이 산출물에서 사라져 채점기가 볼 것이 없어진다.
    for (const r of runBundle().runs) {
      for (const id of r.citedPassageIds) expect(typeof id).toBe('string');
    }
  });
});

describe('재수집 비용 - 무엇을 다시 받아야 하는지', () => {
  it('산출물이 도구별 해시를 갖고 있다 - 없으면 집합 해시로 거칠게 판정한다', () => {
    // 이 필드가 없던 시절에는 도구 하나가 늘어난 것만으로 실행 서른 건과 판정
    // 백스물여섯 건을 통째로 다시 받아야 했다.
    expect(runBundle().toolDigests).toBeTruthy();
    for (const { report } of staleReports()) expect(report.coarse).toBe(false);
  });

  it('지금 도구와 어긋난 실행이 없다', () => {
    for (const { scenarioId, report } of staleReports()) {
      expect(report.changed, scenarioId).toEqual([]);
      expect(report.stale, scenarioId).toBe(false);
    }
  });

  it('쓰지 않은 도구가 늘어도 낡지 않는다 - 재수집을 부르는 조건이 좁다', () => {
    const extra = {
      ...TOOLS[0]!,
      name: 'zzz.brandNew',
      fixtures: ['새 픽스처'],
    };
    const widened = {
      toolsetDigest: 'different',
      toolDigests: toolDigests([...TOOLS, extra]),
    };
    for (const t of traceBundle().traces) {
      const r = checkStale(t, widened, t.toolDigests ?? runBundle().toolDigests);
      expect(r.stale, t.scenarioId).toBe(false);
    }
  });

  it('실행이 쓴 도구가 바뀌면 그 실행만 낡는다', () => {
    const target = 'docqa.answer';
    const tampered = { ...CURRENT_TOOL_FINGERPRINT.toolDigests, [target]: 'changed' };
    const stale = traceBundle()
      .traces.filter(
        (t) =>
          checkStale(
            t,
            { toolsetDigest: 'x', toolDigests: tampered },
            t.toolDigests ?? runBundle().toolDigests,
          ).stale,
      )
      .map((t) => t.scenarioId);
    const usesTarget = traceBundle()
      .traces.filter((t) =>
        t.spans.some((s) => s.kind === 'tool' && (s.attrs['tool.name'] ?? s.name) === target),
      )
      .map((t) => t.scenarioId);
    expect(stale).toEqual(usesTarget);
    expect(stale.length).toBeLessThan(traceBundle().traces.length);
  });

  it('판정에 무엇을 보고 내렸는지의 지문이 있다 - 답과 질문이 그대로면 다시 묻지 않는다', () => {
    const jb = judgmentBundle();
    if (jb.judgments.length === 0) return;
    const answerByRun = new Map(
      runBundle().runs.map((r) => [`${r.scenarioId}|${r.variantId}|${r.runIndex}`, r.answer]),
    );
    const byId = new Map(cases().map((c) => [c.id, c]));
    for (const j of jb.judgments) {
      const c = byId.get(j.caseId)!;
      const question = c.checks.find((k) => k.id === j.checkId)?.question;
      const answer = answerByRun.get(`${c.scenarioId}|${j.variantId}|${j.runIndex}`);
      expect(j.questionDigest, j.caseId).toBe(digest(question!));
      expect(j.answerDigest, j.caseId).toBe(digest(answer!));
    }
  });
});

describe('심판 판정', () => {
  it('존재하는 케이스와 체크만 가리킨다', () => {
    const known = new Set(cases().flatMap((c) => c.checks.map((k) => `${c.id}|${k.id}`)));
    for (const j of judgmentBundle().judgments) {
      expect(known.has(`${j.caseId}|${j.checkId}`), `${j.caseId}/${j.checkId}`).toBe(true);
    }
  });

  it('한 칸에 루브릭 수만큼의 표가 있다 - 평정자 수가 고르지 않으면 kappa 가 무너진다', () => {
    const jb = judgmentBundle();
    if (jb.judgments.length === 0) return;
    const cells = new Map<string, number>();
    for (const j of jb.judgments) {
      const key = [j.caseId, j.checkId, j.variantId, j.runIndex].join('|');
      cells.set(key, (cells.get(key) ?? 0) + 1);
    }
    for (const [key, n] of cells) expect(n, key).toBe(jb.rubrics.length);
  });
});

describe('보고서', () => {
  it('수집 전에도 계산이 깨지지 않고 그 사실을 말한다', () => {
    const r = report();
    expect(r.collected).toBe(hasRuns());
    expect(Number.isFinite(r.ci.estimate)).toBe(true);
  });

  it('심판 판정이 없으면 judge 체크가 통과로 접히지 않는다', () => {
    const r = report();
    if (judgmentBundle().judgments.length > 0) return;
    const judged = r.scores.filter((s) => s.results.some((x) => x.kind === 'judge'));
    for (const s of judged) expect(s.passed).toBe(false);
  });
});

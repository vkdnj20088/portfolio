import type { Budget } from '../types';
import type {
  CaseScore,
  Check,
  CheckResult,
  EvalCase,
  Judgment,
  RunSummary,
  StructureAssertion,
} from './types';

/**
 * 규칙 채점 - 체크의 대부분을 여기서 끝낸다.
 *
 * 규칙이 공짜라서만은 아니다. 규칙 채점은 **심판을 검증할 필요가 없다.** LLM 심판을 하나
 * 쓸 때마다 "그 심판을 누가 심판하는가"가 따라붙고, 앵커셋과 함정 케이스를 붙여야 그 점수를
 * 믿을 근거가 생긴다. 자연어 판단이 아닌 것을 심판에게 맡기면 그 비용을 공짜로 늘리는 셈이다.
 */

function structureOutcome(
  a: StructureAssertion,
  run: RunSummary,
  budget: Budget,
): { ok: boolean; reason: string } {
  switch (a.op) {
    case 'finalStateIs':
      return {
        ok: run.finalState === a.state,
        reason: `최종 상태 ${run.finalState} (기대 ${a.state})`,
      };
    case 'finalStateIn':
      return {
        ok: a.states.includes(run.finalState),
        reason: `최종 상태 ${run.finalState} (기대 ${a.states.join('/')})`,
      };
    case 'toolCalledAtLeast': {
      // 시도 단위가 아니라 **호출 단위**로 센다. 하네스가 재시도한 두 번째 시도까지
      // 따로 세면 "도구를 한 번 불렀다"는 기대가 재시도 여부에 흔들린다.
      const n = run.toolCalls.filter((c) => c.name === a.tool && c.attempt === 1).length;
      return { ok: n >= a.times, reason: `${a.tool} ${n}회 호출 (기대 ${a.times}회 이상)` };
    }
    case 'toolNotCalled': {
      const n = run.toolCalls.filter((c) => c.name === a.tool).length;
      return { ok: n === 0, reason: `${a.tool} ${n}회 호출 (기대 0회)` };
    }
    case 'withinBudget':
      return {
        ok: run.finalState !== 'exhausted',
        reason:
          run.finalState === 'exhausted'
            ? `예산 상한에 걸렸다 (스텝 ${run.spent.steps}/${budget.maxSteps})`
            : `예산 안에서 끝났다 (스텝 ${run.spent.steps}/${budget.maxSteps})`,
      };
    case 'answerMentions': {
      const missing = a.needles.filter((n) => !run.answer.includes(n));
      return {
        ok: missing.length === 0,
        reason: missing.length ? `답에 없는 것: ${missing.join(', ')}` : '요구한 표현이 모두 있다',
      };
    }
  }
}

/**
 * 인용 검증 - 최종 답이 인용한 문단 id 가 **도구 출력에 실제로 있었는지** 본다.
 *
 * 지어냄을 잡는 자리다. 모델이 그럴듯한 id 를 만들어 붙이면 사람 눈에는 근거가 달린 답으로
 * 보이는데, 그 id 가 어느 도구 출력에도 없었다면 근거가 아니라 장식이다. DocuQA 규칙 경로가
 * `verifyGrounding` 으로 하는 일을 에이전트 계층에서 다시 하는 것이고, 층이 하나 올라갔다고
 * 이 검사를 생략할 이유는 없다.
 */
function citationOutcome(run: RunSummary): { ok: boolean; reason: string } {
  if (run.citedPassageIds.length === 0) {
    // 인용이 없는 것 자체는 위반이 아니다. 근거 없음으로 끝낸 실행이 그렇다.
    return { ok: true, reason: '인용한 문단이 없다' };
  }
  const grounded = new Set(run.groundedPassageIds);
  const fabricated = run.citedPassageIds.filter((id) => !grounded.has(id));
  return {
    ok: fabricated.length === 0,
    reason: fabricated.length
      ? `도구 출력에 없던 문단을 인용했다: ${fabricated.join(', ')}`
      : `인용 ${run.citedPassageIds.length}건이 모두 도구 출력에 있었다`,
  };
}

/**
 * 케이스 하나를 실행 하나에 대해 채점한다.
 *
 * judge 체크는 여기서 판정하지 않고 커밋된 심판 판정에서 **다수결**로 가져온다. 심판이
 * 갈린 항목은 그 항목의 기준이 모호하다는 뜻이지 에이전트가 나쁘다는 뜻이 아니라서,
 * 다수결로 접되 갈렸다는 사실은 일치도 쪽에서 따로 드러난다.
 */
export function scoreCase(
  c: EvalCase,
  run: RunSummary,
  budget: Budget,
  judgments: Judgment[],
): CaseScore {
  const results: CheckResult[] = c.checks.map((check) =>
    scoreCheck(c.id, check, run, budget, judgments),
  );
  return {
    caseId: c.id,
    variantId: run.variantId,
    runIndex: run.runIndex,
    // unscored 가 하나라도 있으면 통과라고 말하지 않는다. 채점하지 못한 것을 통과로 접는
    // 순간 "심판 수집 전"이 만점으로 보인다.
    passed: results.every((r) => r.outcome === 'pass'),
    results,
  };
}

function scoreCheck(
  caseId: string,
  check: Check,
  run: RunSummary,
  budget: Budget,
  judgments: Judgment[],
): CheckResult {
  if (check.kind === 'structure') {
    if (!check.assertion) {
      return {
        checkId: check.id,
        kind: check.kind,
        outcome: 'unscored',
        reason: 'assertion 이 없다',
      };
    }
    const { ok, reason } = structureOutcome(check.assertion, run, budget);
    return { checkId: check.id, kind: check.kind, outcome: ok ? 'pass' : 'fail', reason };
  }

  if (check.kind === 'citation') {
    const { ok, reason } = citationOutcome(run);
    return { checkId: check.id, kind: check.kind, outcome: ok ? 'pass' : 'fail', reason };
  }

  return majority(check, votesFor(judgments, caseId, check.id, run.variantId, run.runIndex));
}

/** 한 (케이스, 체크, 구성, 회차) 칸에 대한 심판 표. 루브릭 프레이밍 수만큼 나온다. */
export function votesFor(
  judgments: Judgment[],
  caseId: string,
  checkId: string,
  variantId: string,
  runIndex: number,
): Judgment[] {
  return judgments.filter(
    (j) =>
      j.caseId === caseId &&
      j.checkId === checkId &&
      j.variantId === variantId &&
      j.runIndex === runIndex,
  );
}

/** 심판 다수결. 표가 없으면 통과가 아니라 `unscored` 다. */
export function majority(check: Check, votes: Judgment[]): CheckResult {
  if (votes.length === 0) {
    return {
      checkId: check.id,
      kind: check.kind,
      outcome: 'unscored',
      reason: '심판 판정이 아직 수집되지 않았다',
    };
  }
  const tally = { pass: 0, fail: 0, blocked: 0 };
  for (const v of votes) tally[v.verdict] += 1;
  const top = (Object.keys(tally) as (keyof typeof tally)[]).reduce((a, b) =>
    tally[a] >= tally[b] ? a : b,
  );
  const split = votes.length - tally[top];
  return {
    checkId: check.id,
    kind: check.kind,
    outcome: top,
    reason:
      `심판 ${votes.length}명 중 ${tally[top]}명이 ${top}` +
      (split ? ` (${split}명 갈림) - ${votes.find((v) => v.verdict !== top)?.reason ?? ''}` : '') +
      (split ? '' : ` - ${votes[0]!.reason}`),
  };
}

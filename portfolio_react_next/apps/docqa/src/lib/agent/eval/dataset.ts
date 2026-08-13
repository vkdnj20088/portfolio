import {
  type CaseBundle,
  type EvalCase,
  type EvalReport,
  type JudgmentBundle,
  type OriginReport,
  type RunBundle,
  buildReport,
  validateOrigins,
} from '@chat/agent-core';
import { SCENARIOS } from '../scenarios';
import { traceBundle } from '../traces';
import caseData from '../data/cases.json';
import runData from '../data/runs.json';
import judgmentData from '../data/judgments.json';

/**
 * 커밋된 평가 자산을 읽어 화면이 쓸 보고서 하나로 접는다.
 *
 * 셋 다 산출물이지만 성격이 다르다. `cases.json` 은 **사람이 승격한 자산**이라 손으로
 * 편집되고 코드처럼 리뷰된다. `runs.json`/`judgments.json` 은 키를 가진 사람이 한 번
 * 수집해 굳힌 기록이라 손으로 고치면 안 된다. 손으로 고칠 수 있는 쪽만 검증기를 거친다.
 */

export function caseBundle(): CaseBundle {
  return caseData as CaseBundle;
}

export function runBundle(): RunBundle {
  return runData as RunBundle;
}

export function judgmentBundle(): JudgmentBundle {
  return judgmentData as JudgmentBundle;
}

export function cases(): EvalCase[] {
  return caseBundle().cases;
}

/** 시나리오별 예산. 채점기가 "예산 안에서 끝났는가"를 판정하려면 이것이 필요하다. */
export function budgets() {
  return new Map(SCENARIOS.map((s) => [s.id, s.budget]));
}

/**
 * 승격 자산의 무결성. 채점을 망가뜨리는 오류와, 되짚기 링크만 끊긴 낡음을 갈라 낸다.
 * 오류는 화면이 수치를 보이기 전에 비어 있어야 하고, 낡음은 사실만 적으면 된다.
 */
export function caseProblems(): OriginReport {
  return validateOrigins(cases(), traceBundle().traces);
}

export function hasRuns(): boolean {
  return runBundle().runs.length > 0;
}

export function report(): EvalReport {
  const rb = runBundle();
  const jb = judgmentBundle();
  return buildReport({
    cases: cases(),
    runs: rb.runs,
    variants: rb.variants,
    judgments: jb.judgments,
    trapJudgments: jb.trapJudgments,
    budgets: budgets(),
  });
}

/**
 * 케이스가 시나리오 몇 개에서 나왔는지. 화면이 이 수를 밝혀야 하는 이유가 있다 -
 * 부트스트랩은 케이스를 독립 표본처럼 재표집하는데, 같은 시나리오에서 나온 케이스들은
 * 실제로는 독립이 아니다. 그만큼 구간이 실제보다 좁게 나온다.
 */
export function scenarioSpread(): { cases: number; scenarios: number } {
  return {
    cases: cases().length,
    scenarios: new Set(cases().map((c) => c.scenarioId)).size,
  };
}

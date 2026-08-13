import type { Budget } from '../types';
import { type Agreement, type JudgeTrust, agreementOf, judgeTrust } from './agreement';
import { scoreCase } from './rules';
import {
  type DiffCi,
  type McNemarResult,
  type PairedObservation,
  type Power,
  type SelfSpread,
  type Verdict,
  bootstrapDiffCi,
  mcnemarExact,
  power,
  selfSpread,
  spreadsOverlap,
  verdictOf,
} from './stats';
import type { CaseScore, EvalCase, Judgment, RunSummary, Variant } from './types';

/**
 * 화면이 필요로 하는 것을 한 번에 계산한다.
 *
 * 페이지에 계산을 흩어 두지 않는 이유는 테스트다. 통계의 경계값 - 구간이 0 을 포함할 때,
 * 표본이 모자랄 때 - 은 화면 문구로 곧장 이어지므로, 문구를 고르는 자리까지 테스트가 닿아야 한다.
 * 여기까지가 순수 함수라 그게 가능하다.
 */

export interface PerCaseRow {
  caseId: string;
  title: string;
  scenarioId: string;
  /** 구성별 통과 횟수 / 반복 수. */
  byVariant: Record<string, { passed: number; total: number }>;
}

export interface EvalReport {
  collected: boolean;
  variants: Variant[];
  scores: CaseScore[];
  passRate: Record<string, { passed: number; total: number; rate: number }>;
  spreads: SelfSpread[];
  spreadsOverlap: boolean;
  pairs: PairedObservation[];
  mcnemar: McNemarResult;
  ci: DiffCi;
  power: Power;
  verdict: Verdict;
  agreement: Agreement;
  trust: JudgeTrust;
  perCase: PerCaseRow[];
  /** 채점하지 못한 체크가 있는 칸. 통과로 접지 않았다는 것을 화면이 말해야 한다. */
  unscored: number;
}

export function buildReport(input: {
  cases: EvalCase[];
  runs: RunSummary[];
  variants: Variant[];
  judgments: Judgment[];
  trapJudgments: Judgment[];
  budgets: Map<string, Budget>;
  bootstrapSeed?: number;
}): EvalReport {
  const { cases, runs, variants, judgments, trapJudgments, budgets } = input;

  const scores: CaseScore[] = [];
  for (const c of cases) {
    for (const run of runs) {
      if (run.scenarioId !== c.scenarioId) continue;
      const budget = budgets.get(c.scenarioId);
      if (!budget) continue;
      scores.push(scoreCase(c, run, budget, judgments));
    }
  }

  const passRate: EvalReport['passRate'] = {};
  for (const v of variants) {
    const mine = scores.filter((s) => s.variantId === v.id);
    const passed = mine.filter((s) => s.passed).length;
    passRate[v.id] = { passed, total: mine.length, rate: mine.length ? passed / mine.length : 0 };
  }

  const spreads = variants.map((v) => selfSpread(scores, v.id));
  const [a, b] = variants;
  const pairs: PairedObservation[] = [];
  if (a && b) {
    for (const sa of scores.filter((s) => s.variantId === a.id)) {
      const sb = scores.find(
        (s) => s.variantId === b.id && s.caseId === sa.caseId && s.runIndex === sa.runIndex,
      );
      // 짝이 없는 실행은 버린다. 쌍대 검정은 같은 케이스를 둘 다 푼 것만 센다.
      if (sb) pairs.push({ caseId: sa.caseId, runIndex: sa.runIndex, a: sa.passed, b: sb.passed });
    }
  }

  const mcnemar = mcnemarExact(pairs);
  const ci = bootstrapDiffCi(pairs, input.bootstrapSeed);
  const pw = power(pairs.length);

  const perCase: PerCaseRow[] = cases.map((c) => {
    const byVariant: PerCaseRow['byVariant'] = {};
    for (const v of variants) {
      const mine = scores.filter((s) => s.caseId === c.id && s.variantId === v.id);
      byVariant[v.id] = { passed: mine.filter((s) => s.passed).length, total: mine.length };
    }
    return { caseId: c.id, title: c.title, scenarioId: c.scenarioId, byVariant };
  });

  // 앵커는 케이스가 승격된 그 실행(origin)에 붙은 사람 라벨이다.
  const anchors = cases
    .filter((c) => c.humanLabel !== null)
    .map((c) => ({
      caseId: c.id,
      variantId: c.origin.variantId,
      runIndex: c.origin.runIndex,
      humanLabel: c.humanLabel as boolean,
    }));

  return {
    collected: runs.length > 0,
    variants,
    scores,
    passRate,
    spreads,
    spreadsOverlap: spreads.length === 2 ? spreadsOverlap(spreads[0]!, spreads[1]!) : false,
    pairs,
    mcnemar,
    ci,
    power: pw,
    verdict: verdictOf(mcnemar, ci, pw),
    agreement: agreementOf(judgments),
    trust: judgeTrust(anchors, judgments, trapJudgments),
    perCase,
    unscored: scores.filter((s) => s.results.some((r) => r.outcome === 'unscored')).length,
  };
}

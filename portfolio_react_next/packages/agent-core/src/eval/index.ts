export type {
  CaseBundle,
  CaseOrigin,
  CaseScore,
  Check,
  CheckKind,
  CheckOutcome,
  CheckResult,
  EvalCase,
  Judgment,
  JudgmentBundle,
  RunBundle,
  RunSummary,
  RunToolCall,
  StructureAssertion,
  Variant,
} from './types';

export { majority, scoreCase, votesFor } from './rules';

export {
  VERDICT_LABEL,
  bootstrapDiffCi,
  mcnemarExact,
  power,
  seededRng,
  selfSpread,
  spreadsOverlap,
  verdictOf,
} from './stats';
export type { DiffCi, McNemarResult, PairedObservation, Power, SelfSpread, Verdict } from './stats';

export { agreementOf, fleissKappa, judgeTrust } from './agreement';
export type { Agreement, JudgeTrust } from './agreement';

export { backIndex, originKey, proposeCase, proposeChecks, validateOrigins } from './promote';
export type { OriginReport } from './promote';

export { buildReport } from './report';
export type { EvalReport, PerCaseRow } from './report';

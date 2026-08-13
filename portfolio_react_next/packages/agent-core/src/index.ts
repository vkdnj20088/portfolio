export type {
  ArgSource,
  Budget,
  BudgetSpent,
  RunState,
  Span,
  SpanAttrs,
  SpanKind,
  SpanStatus,
  SpanTimings,
  SpanVerification,
  ReplayVerdict,
  ToolContext,
  ToolDefinition,
  ToolFailure,
  ToolResult,
  ToolSuccess,
  TraceArtifact,
  TraceBundle,
} from './types';

export { digest, stableStringify } from './digest';
export { createIdFactory, isCorrelationSafe } from './ids';
export { DEFAULT_BACKOFF, backoffDelayMs } from './backoff';
export type { BackoffConfig } from './backoff';
export { STATE_LABEL, canTransition, isTerminal, stateTone, transition } from './machine';
export { DEFAULT_BUDGET, budgetPressure, checkBudget, rollUp } from './budget';
export type { BudgetVerdict } from './budget';
export { alwaysExpanded, buildTree, flatten } from './tree';
export type { SpanNode } from './tree';
export { checkStale, toolsetDigest, verifyToolSpans } from './replay';
export type { StaleReport } from './replay';

// 2단계 - 실행 여럿을 놓고 회귀인지 잡음인지 판정하는 층.
export * from './eval';

// 3단계 - 하지 말아야 할 일을 하려 할 때 무엇이 막는가.
export * from './guard';

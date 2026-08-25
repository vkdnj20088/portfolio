export type {
  ApprovalEvent,
  ApprovalEventType,
  ApprovalStatus,
  Clock,
  PaymentRequest,
  TransitionResult,
} from './types';
export { STATUS_LABEL, canTransition } from './transitions';
export {
  APPROVER_MODE_LABEL,
  ApproverDownError,
  ApproverStub,
  ApproverTimeoutError,
  type ApproveRequest,
  type ApproverMode,
} from './approver';
export { MemoryStore, type ReceiveInput } from './store';
export {
  ApprovalWorker,
  DEFAULT_STALE_CLAIM_MS,
  MAX_APPROVE_ATTEMPTS,
  MAX_RECONCILE_FAILURES,
  emptyReport,
  type TickReport,
  type WorkerOptions,
} from './worker';
export { EventConsumer } from './consumer';
export { createHandlers, type ApiResponse, type Handlers } from './api';
export { buildApp, createSequentialClock, type App } from './app';

// 방어선을 하나씩 끄는 층. 원본 엔진에 없던 경로라 off/on 대조가 여기서 성립한다.
export {
  ALL_GUARDS_ON,
  GUARD_LABEL,
  GUARD_WHEN_OFF,
  RECLAIM_TARGET_LABEL,
  UNKNOWN_FALLBACK_LABEL,
  type GuardConfig,
  type ReclaimTarget,
  type UnknownFallback,
} from './guards';
export {
  DEFAULT_LAB_CONFIG,
  LAB_AMOUNT,
  LAB_METHOD,
  describeEvent,
  runLab,
  type LabConfig,
  type LabCounters,
  type LabRequestView,
  type LabRun,
  type LabStep,
  type LabTone,
} from './lab';
export {
  PRESETS,
  presetById,
  type LabExpectation,
  type Preset,
  type PresetId,
  type PresetSide,
  type PresetSideSpec,
} from './presets';

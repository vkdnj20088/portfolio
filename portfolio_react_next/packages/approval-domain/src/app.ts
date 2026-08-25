import { MemoryStore } from './store';
import { ApproverStub, type ApproverMode } from './approver';
import { ApprovalWorker } from './worker';
import { createHandlers, type Handlers } from './api';
import type { Clock } from './types';
import {
  ALL_GUARDS_ON,
  type GuardConfig,
  type ReclaimTarget,
  type UnknownFallback,
} from './guards';

export interface App {
  store: MemoryStore;
  approver: ApproverStub;
  worker: ApprovalWorker;
  handlers: Handlers;
  clock: Clock;
}

/**
 * 순번 시계와 순번 ID. 이 엔진에는 난수가 없으므로 시간과 ID 만 고정하면 실행 전체가
 * 결정적이다 - 시드를 따로 두지 않은 이유가 이것이다. 재현의 단위는 난수 시드가 아니라
 * 시나리오 파라미터(PG 모드·워커 수·가드 조합)다.
 */
export function createSequentialClock(startIso = '2026-08-20T09:00:00.000Z'): Clock {
  const base = Date.parse(startIso);
  let ticks = 0;
  let ids = 0;
  return {
    now: () => {
      ticks += 1;
      return new Date(base + ticks).toISOString();
    },
    newId: () => {
      ids += 1;
      return `pay-${ids}`;
    },
  };
}

export interface BuildOptions {
  approverMode?: ApproverMode;
  clock?: Clock;
  staleClaimMs?: number;
  guards?: GuardConfig;
  unknownFallback?: UnknownFallback;
  reclaimTo?: ReclaimTarget;
}

/** 조립 지점. 시간·ID·가드 설정을 여기서 주입한다. */
export function buildApp(opts: BuildOptions = {}): App {
  const clock = opts.clock ?? createSequentialClock();
  const guards = opts.guards ?? ALL_GUARDS_ON;
  const store = new MemoryStore(clock, guards);
  const approver = new ApproverStub(opts.approverMode ?? 'normal');
  const worker = new ApprovalWorker(store, approver, {
    now: clock.now,
    staleClaimMs: opts.staleClaimMs,
    guards,
    unknownFallback: opts.unknownFallback,
    reclaimTo: opts.reclaimTo,
  });
  const handlers = createHandlers(store);
  return { store, approver, worker, handlers, clock };
}

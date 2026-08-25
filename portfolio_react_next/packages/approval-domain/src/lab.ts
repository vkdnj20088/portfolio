import { buildApp, createSequentialClock } from './app';
import { ApprovalWorker, DEFAULT_STALE_CLAIM_MS, type TickReport } from './worker';
import type { ApproverMode } from './approver';
import {
  ALL_GUARDS_ON,
  type GuardConfig,
  type ReclaimTarget,
  type UnknownFallback,
} from './guards';
import { RECLAIM_TARGET_LABEL } from './guards';
import type { ApprovalEvent, ApprovalEventType, ApprovalStatus } from './types';

/** 실험대에서 쓰는 고정 결제. 금액과 수단을 시나리오마다 바꾸면 비교가 흐려진다. */
export const LAB_AMOUNT = 128_000;
export const LAB_METHOD = 'card';
const LAB_IDEMPOTENCY_KEY = 'req-1';

export interface LabConfig {
  approverMode: ApproverMode;
  guards: GuardConfig;
  unknownFallback: UnknownFallback;
  reclaimTo: ReclaimTarget;
  workers: 1 | 2;
  /** 아웃박스가 같은 배치를 한 번 더 전달하게 한다(at-least-once 의 정상 범위). */
  redeliver: boolean;
  /** 같은 멱등키로 두 번 접수한다 - 더블클릭. */
  doubleSubmit: boolean;
  /** 클레임만 쥐고 승인 요청까지 보낸 뒤 죽은 워커를 심는다. */
  deadWorkerClaim: boolean;
  /** 이 tick 이 시작될 때 PG 가 정상으로 돌아온다. null 이면 끝까지 그대로다. */
  approverRecoversAtTick: number | null;
  staleClaimMs: number;
  ticks: number;
}

export type LabTone = 'neutral' | 'ok' | 'warn' | 'bad';

export interface LabStep {
  seq: number;
  /** 0 은 tick 이전의 준비 구간(접수·워커 사망 주입)이다. */
  tick: number;
  requestId: string;
  type: ApprovalEventType | 'SettleConflict';
  label: string;
  why: string | null;
  tone: LabTone;
}

export interface LabCounters {
  /** PG 쪽에 실제로 남은 승인 건수. 이 화면의 판정 수치다. */
  approvedAtPg: number;
  /** 우리가 승인 요청을 호출한 횟수. 승인 건수와 갈라 보여야 무엇이 막혔는지 알 수 있다. */
  approveCalls: number;
  queryCalls: number;
  /** 우리 쪽에 만들어진 결제 요청 수. 더블클릭 방어선이 여기서 드러난다. */
  requests: number;
}

export interface LabRequestView {
  id: string;
  status: ApprovalStatus;
  approveAttempts: number;
  reconcileFailures: number;
  approvalNo: string | null;
}

export interface LabRun {
  timeline: LabStep[];
  counters: LabCounters;
  requests: LabRequestView[];
  /** 클레임을 쥔 뒤의 전이 실패. 정상 경합이 아니라 조사 대상이라 따로 센다. */
  settleConflicts: number;
  reports: TickReport[];
}

export const DEFAULT_LAB_CONFIG: LabConfig = {
  approverMode: 'normal',
  guards: ALL_GUARDS_ON,
  unknownFallback: 'retry',
  reclaimTo: 'unknown',
  workers: 1,
  redeliver: false,
  doubleSubmit: false,
  deadWorkerClaim: false,
  approverRecoversAtTick: null,
  staleClaimMs: DEFAULT_STALE_CLAIM_MS,
  ticks: 3,
};

const EVENT_LABEL: Record<ApprovalEventType, string> = {
  PaymentReceived: '결제 요청 접수',
  ApprovalStarted: '승인 요청 전송',
  ApprovalConfirmed: '승인 확인',
  ApprovalTimedOut: '응답 없음 - 모름',
  ApprovalReconciled: '승인 조회',
  ApprovalRetryScheduled: '재시도 대기',
  ApprovalClaimReclaimed: '멈춘 클레임 회수',
  ApprovalQuarantined: '격리',
  PaymentCancelled: '취소',
};

function str(detail: Record<string, unknown> | undefined, key: string): string | null {
  const value = detail?.[key];
  return typeof value === 'string' ? value : null;
}

/**
 * 이벤트 한 줄을 "무엇이 일어났는가 + 왜"로 편다.
 *
 * 화면이 상태 이름만 늘어놓으면 옳은 실행과 틀린 실행이 똑같이 생겼다. 전이마다 근거를
 * 붙여야 껐을 때의 타임라인이 왜 틀렸는지가 읽힌다. 근거는 지어내지 않고 이벤트가 남긴
 * detail 에서만 가져온다 - 없으면 null 이다.
 */
export function describeEvent(event: ApprovalEvent): {
  label: string;
  why: string | null;
  tone: LabTone;
} {
  const { type, detail } = event;
  const guardOff = str(detail, 'guard') !== null;
  const reason = str(detail, 'reason');

  switch (type) {
    case 'ApprovalConfirmed': {
      const no = str(detail, 'approvalNo');
      // 실험대는 논리적으로 한 건의 결제만 다루므로, 두 번째 승인번호는 곧 이중 승인이다.
      const duplicated = no !== null && no !== 'A-1';
      return {
        label: EVENT_LABEL[type],
        why: duplicated
          ? `승인번호 ${no} - 이미 A-1 이 있는데 또 승인됐다`
          : `승인번호 ${no ?? '?'}`,
        tone: duplicated ? 'bad' : 'ok',
      };
    }
    case 'ApprovalReconciled': {
      const outcome = str(detail, 'outcome');
      if (outcome === 'already_approved') {
        return {
          label: `${EVENT_LABEL[type]}: 이미 승인됨`,
          why: '재전송하지 않고 확정한다',
          tone: 'ok',
        };
      }
      const failures = detail?.['reconcileFailures'];
      return {
        label: `${EVENT_LABEL[type]}: 실패`,
        why: `조회 실패 ${typeof failures === 'number' ? failures : '?'}회 - 상태는 모름 그대로`,
        tone: 'warn',
      };
    }
    case 'ApprovalStarted':
      return {
        label: EVENT_LABEL[type],
        why: reason ?? '접수 이벤트를 받고 클레임을 쥐었다',
        tone: guardOff ? 'bad' : 'neutral',
      };
    case 'ApprovalTimedOut':
      return {
        label: EVENT_LABEL[type],
        why: '승인 여부를 알 수 없어 그대로 저장한다',
        tone: 'warn',
      };
    case 'ApprovalRetryScheduled':
      return {
        label: EVENT_LABEL[type],
        why: reason ?? '미승인이 확실해 재전송이 안전하다',
        tone: guardOff ? 'bad' : 'warn',
      };
    case 'ApprovalClaimReclaimed': {
      const target = str(detail, 'target');
      const held = detail?.['heldMs'];
      const where =
        target === 'RECEIVED' ? RECLAIM_TARGET_LABEL.received : RECLAIM_TARGET_LABEL.unknown;
      return {
        label: EVENT_LABEL[type],
        why: `${typeof held === 'number' ? held : '?'}ms 동안 진행이 없어 ${where}`,
        tone: target === 'RECEIVED' ? 'bad' : 'warn',
      };
    }
    case 'ApprovalQuarantined':
      return { label: EVENT_LABEL[type], why: reason, tone: guardOff ? 'bad' : 'warn' };
    case 'PaymentReceived':
      return { label: EVENT_LABEL[type], why: null, tone: 'neutral' };
    default:
      return { label: EVENT_LABEL[type], why: reason, tone: 'neutral' };
  }
}

/**
 * 실험 한 번. 같은 설정은 항상 같은 타임라인을 낸다 - 난수가 없고 시간과 ID 를 주입하기 때문이다.
 * 이 함수가 화면과 실측 스크립트의 공통 입구다. 둘이 다른 경로로 돌면 화면의 숫자와
 * 커밋된 숫자가 갈라질 수 있다.
 */
export function runLab(config: LabConfig): LabRun {
  const app = buildApp({
    approverMode: config.approverMode,
    clock: createSequentialClock(),
    staleClaimMs: config.staleClaimMs,
    guards: config.guards,
    unknownFallback: config.unknownFallback,
    reclaimTo: config.reclaimTo,
  });

  const first = app.handlers.receivePayment(
    { amount: LAB_AMOUNT, method: LAB_METHOD },
    LAB_IDEMPOTENCY_KEY,
  );
  const firstId = (first.body as { requestId: string }).requestId;
  if (config.doubleSubmit) {
    app.handlers.receivePayment({ amount: LAB_AMOUNT, method: LAB_METHOD }, LAB_IDEMPOTENCY_KEY);
  }
  if (config.deadWorkerClaim) {
    // 클레임을 쥐고 승인 요청까지 보낸 뒤 그 사실을 남기기 직전에 죽은 워커.
    // 회수 목적지 선택이 실제로 갈리는 유일한 상황이라 실험대에 심어 둔다.
    // 근거를 함께 남긴다. 안 남기면 타임라인이 이 줄을 "접수 이벤트를 받고 클레임을 쥐었다"로
    // 읽어 화면이 사실이 아닌 것을 말하게 된다.
    app.store.transition(
      firstId,
      'RECEIVED',
      'APPROVING',
      'ApprovalStarted',
      { reason: '워커가 클레임을 쥐고 승인 요청까지 보낸 뒤 죽었다' },
      (r) => {
        r.approveAttempts += 1;
      },
    );
    try {
      app.approver.approve({ requestId: firstId, amount: LAB_AMOUNT, method: LAB_METHOD });
    } catch {
      // 죽은 워커는 결과를 못 받았다. 이 실험에서 그 예외는 사실의 일부라 삼킨다.
    }
  }

  const workerOptions = {
    now: app.clock.now,
    staleClaimMs: config.staleClaimMs,
    guards: config.guards,
    unknownFallback: config.unknownFallback,
    reclaimTo: config.reclaimTo,
  };
  const workers = [app.worker];
  if (config.workers === 2) {
    workers.push(new ApprovalWorker(app.store, app.approver, workerOptions));
  }

  const timeline: LabStep[] = [];
  let consumed = 0;
  let seq = 0;

  const drain = (tick: number) => {
    const events = app.store.allEvents().slice(consumed);
    consumed += events.length;
    for (const event of events) {
      const described = describeEvent(event);
      seq += 1;
      timeline.push({ seq, tick, requestId: event.requestId, type: event.type, ...described });
    }
  };

  drain(0);

  const reports: TickReport[] = [];
  for (let tick = 1; tick <= config.ticks; tick += 1) {
    if (config.approverRecoversAtTick === tick) app.approver.mode = 'normal';
    if (config.redeliver && tick === 1) app.store.forceRedeliverNextRead();
    for (const worker of workers) {
      const report = worker.tick();
      reports.push(report);
      drain(tick);
      for (const conflict of report.settleConflicts) {
        seq += 1;
        timeline.push({
          seq,
          tick,
          requestId: conflict.requestId,
          type: 'SettleConflict',
          label: '조사 대상: 클레임 이후 전이 실패',
          why: `${conflict.expected} 를 기대했는데 ${conflict.actual ?? '알 수 없음'} 이었다 - 승인 요청은 나갔는데 상태를 남기지 못한 경우가 여기 걸린다`,
          tone: 'bad',
        });
      }
    }
  }

  return {
    timeline,
    counters: {
      approvedAtPg: app.approver.approvedCount(),
      approveCalls: app.approver.approveCalls,
      queryCalls: app.approver.queryCalls,
      requests: app.store.allRequests().length,
    },
    requests: app.store.allRequests().map((r) => ({
      id: r.id,
      status: r.status,
      approveAttempts: r.approveAttempts,
      reconcileFailures: r.reconcileFailures,
      approvalNo: r.approvalNo ?? null,
    })),
    settleConflicts: reports.reduce((n, r) => n + r.settleConflicts.length, 0),
    reports,
  };
}

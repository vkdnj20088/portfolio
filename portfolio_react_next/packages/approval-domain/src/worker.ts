import type { MemoryStore } from './store';
import type { PaymentRequest, TransitionResult } from './types';
import { ApproverDownError, ApproverTimeoutError, type ApproverStub } from './approver';
import {
  ALL_GUARDS_ON,
  type GuardConfig,
  type ReclaimTarget,
  type UnknownFallback,
} from './guards';

/**
 * 전송 시도 상한. 이 값을 넘기면 자동 재시도를 멈추고 격리한다.
 * PG 장애는 대개 짧게 지나가는 사건이라 두어 번의 재시도로 대부분 흡수되고,
 * 그보다 길게 끌면 "언젠가 되겠지" 상태의 결제가 쌓여 상담이 현재 상황을 답할 수 없게 된다.
 */
export const MAX_APPROVE_ATTEMPTS = 3;

/**
 * 조회 실패 상한. 전송 상한과 **다른 상한**이다 - 전송은 우리가 PG 를 몇 번 두드렸는가이고,
 * 이쪽은 그 결과를 몇 번 확인하려다 실패했는가다. 하나로 합치면 "보내다 실패했다"와
 * "보낸 결과를 모른다"가 같은 칸에 들어가 격리 사유가 뭉개진다.
 */
export const MAX_RECONCILE_FAILURES = 3;

/**
 * 이 시간을 넘겨 `APPROVING` 에 머문 요청은 처리하던 워커가 죽은 것으로 보고 회수한다.
 * 값의 근거는 "PG 응답이 이만큼 늦기도 한다"는 관측이고, 그보다 짧게 잡으면
 * 살아서 응답을 기다리는 중인 요청을 회수해 버린다. 실측으로 조정할 값이다.
 */
export const DEFAULT_STALE_CLAIM_MS = 30_000;

export interface WorkerOptions {
  now: () => string;
  staleClaimMs?: number;
  guards?: GuardConfig;
  /** 대사를 껐을 때 timeout 을 어느 쪽으로 접을지. 켜져 있으면 쓰이지 않는다. */
  unknownFallback?: UnknownFallback;
  reclaimTo?: ReclaimTarget;
}

export interface TickReport {
  /** 아웃박스에서 이번 tick 에 새로 전달받은 이벤트 수 */
  delivered: number;
  approved: string[];
  /** timeout 으로 '모름'이 된 요청 */
  unknown: string[];
  /** 조회 결과 이미 승인돼 있어서 재전송 없이 확정한 요청 - 이 데모가 증명하는 자리 */
  reconciledConfirmed: string[];
  /** 조회로 미승인을 확인한 뒤 안전하게 재전송한 요청 */
  resent: string[];
  retryScheduled: string[];
  /** 처리하던 워커가 죽어 `APPROVING` 에 멈춰 있던 요청을 회수한 것 */
  reclaimed: string[];
  quarantined: string[];
  /** 클레임 선점 실패로 건너뛴 시도 - 오류가 아니라 중복 방어선이 작동한 자리다 */
  claimSkipped: { requestId: string; actual?: string }[];
  /**
   * 클레임을 쥔 뒤의 전이가 실패한 경우. 이건 정상 경합이 아니라 조사 대상이다 -
   * 특히 PG 에 승인 요청은 나갔는데 그 사실을 상태로 남기지 못한 경우가 여기 걸린다.
   */
  settleConflicts: { requestId: string; expected: string; actual?: string }[];
}

export function emptyReport(): TickReport {
  return {
    delivered: 0,
    approved: [],
    unknown: [],
    reconciledConfirmed: [],
    resent: [],
    retryScheduled: [],
    reclaimed: [],
    quarantined: [],
    claimSkipped: [],
    settleConflicts: [],
  };
}

/**
 * 승인 처리기. 결제 요청을 PG 로 보내고, 실패를 종류별로 다르게 다룬다.
 *
 * 입력이 둘이다:
 *  1) 아웃박스 커서 폴링 - 신규 요청의 정상 경로. 이 스트림은 승인기 전용이 아니라
 *     정산·상담이 각자 커서로 같이 소비하는 공용 스트림이다.
 *  2) 상태 스윕 - 미해소 요청(모름·재시도 대기)의 복구 경로. 이벤트는 한 번 소비되면
 *     사라지지만 상태는 남으므로, 워커가 죽었다 살아나도 스윕이 있으면 이어서 복구된다.
 *     워커를 무상태로 둘 수 있는 것도 이 덕분이다.
 *
 * 운영에서는 주기 실행이지만 여기서는 tick()을 직접 호출한다.
 * 시간을 주입해야 같은 입력이 같은 출력을 낸다.
 */
export class ApprovalWorker {
  private cursor = 0;
  private readonly staleClaimMs: number;
  private readonly guards: GuardConfig;
  private readonly unknownFallback: UnknownFallback;
  private readonly reclaimTo: ReclaimTarget;

  constructor(
    private store: MemoryStore,
    private approver: ApproverStub,
    private options: WorkerOptions,
  ) {
    this.staleClaimMs = options.staleClaimMs ?? DEFAULT_STALE_CLAIM_MS;
    this.guards = options.guards ?? ALL_GUARDS_ON;
    this.unknownFallback = options.unknownFallback ?? 'retry';
    this.reclaimTo = options.reclaimTo ?? 'unknown';
  }

  /**
   * 상한 두 개를 따로 묻는다. 전송 상한은 "우리가 PG 를 몇 번 두드렸는가"이고 조회 상한은
   * "그 결과를 몇 번 확인하려다 실패했는가"라, 한 칸에 세면 격리 사유가 뭉개진다.
   */
  private atApproveLimit(attempts: number): boolean {
    return this.guards.attemptLimit && attempts >= MAX_APPROVE_ATTEMPTS;
  }

  private atReconcileLimit(failures: number): boolean {
    return this.guards.attemptLimit && failures >= MAX_RECONCILE_FAILURES;
  }

  tick(): TickReport {
    const report = emptyReport();
    // 한 tick 안에서 같은 요청을 두 번 건드리지 않기 위한 표시.
    // 이게 없으면 전송 실패로 재시도 대기가 된 요청을 같은 tick 의 스윕이 즉시 다시 집어
    // 시도 상한을 한 번에 소진한다 - 재시도 간격이 사라지는 셈이다.
    const touched = new Set<string>();

    // 1단계: 아웃박스 폴링 (신규 요청의 정상 경로)
    const events = this.store.readEventsAfter(this.cursor, ['PaymentReceived']);
    report.delivered = events.length;
    for (const event of events) {
      touched.add(event.requestId);
      this.claimAndApprove(event.requestId, report);
    }
    // 커서는 처리 후에 전진시킨다. 중간에 죽으면 같은 이벤트가 다시 오는 at-least-once
    // 규약이고, 그 중복은 아래 클레임(조건부 전이)이 흡수한다. 되돌아가지는 않는다 -
    // 재전달로 지나간 이벤트가 섞여 들어와도 커서를 뒤로 물리면 같은 배치를 영원히 다시 받는다.
    const last = events.at(-1);
    if (last) this.cursor = Math.max(this.cursor, last.seq);

    // 2단계: 상태 스윕 (미해소 요청의 복구 경로)
    // 먼저 멈춰 있는 클레임부터 회수한다. 회수된 요청은 같은 tick 의 아래 대사 루프가
    // 이미 지나갔으므로 다음 주기에 처리된다 - 회수와 대사를 한 tick 에 몰지 않는다.
    for (const request of this.store.requestsIn('APPROVING')) {
      if (touched.has(request.id)) continue;
      const heldMs = Date.parse(this.options.now()) - Date.parse(request.updatedAt);
      if (heldMs < this.staleClaimMs) continue;
      touched.add(request.id);
      // 회수 목적지의 기본값이 RECEIVED 가 아니라 APPROVAL_UNKNOWN 인 것이 핵심이다.
      // 워커가 죽은 시점이 PG 전송 전인지 후인지 우리는 모른다. RECEIVED 로 되돌리면
      // 곧바로 재승인 요청이 나가고, 그것이 이미 승인된 결제였다면 이중 승인이 된다.
      // 모르는 것은 모른다고 적고, 다음 주기의 대사가 조회로 푼다.
      const target = this.reclaimTo === 'received' ? 'RECEIVED' : 'APPROVAL_UNKNOWN';
      const reclaimed = this.store.transition(
        request.id,
        'APPROVING',
        target,
        'ApprovalClaimReclaimed',
        { heldMs, attempts: request.approveAttempts, target },
      );
      if (this.settled(reclaimed, report)) report.reclaimed.push(request.id);
    }

    for (const request of this.store.requestsIn('APPROVAL_UNKNOWN')) {
      if (touched.has(request.id)) continue;
      touched.add(request.id);
      this.reconcile(request.id, report);
    }
    for (const request of this.store.requestsIn('RECEIVED')) {
      if (touched.has(request.id)) continue;
      touched.add(request.id);
      this.claimAndApprove(request.id, report);
    }

    return report;
  }

  /**
   * 클레임을 쥔 뒤의 전이는 우리 말고 아무도 건드릴 수 없어야 하므로 실패할 이유가 없다.
   * 그런데도 실패했다면 우리가 모르는 경합이 있었다는 뜻이라, 성공으로 적지 않고 보고서에 남긴다.
   * 여기서 결과를 확인하지 않으면 "승인 요청은 나갔는데 상태는 안 바뀐" 결제가 조용히 생기고,
   * 그 결제는 나중에 다시 집혀 이중 승인이 된다.
   */
  private settled(result: TransitionResult, report: TickReport): boolean {
    if (result.ok) return true;
    report.settleConflicts.push({
      requestId: result.requestId,
      expected: result.expected,
      actual: result.actual,
    });
    return false;
  }

  /** 승인 클레임 - 조건부 전이라 동시에 몇 명이 시도해도 한 번만 성공한다 (내부 중복 방어선). */
  private claimAndApprove(requestId: string, report: TickReport): void {
    const claim = this.store.transition(
      requestId,
      'RECEIVED',
      'APPROVING',
      'ApprovalStarted',
      undefined,
      (request) => {
        request.approveAttempts += 1;
      },
    );
    if (!claim.ok) {
      report.claimSkipped.push({ requestId, actual: claim.actual });
      return;
    }
    this.sendAndSettle(claim.request, report);
  }

  /**
   * PG 전송과 그 결과의 정착. 실패를 세 갈래로 가른다 -
   * 응답 유실(모름) / 미승인 확실(재시도) / 분류 불가(그대로 올린다).
   * 이 셋을 "승인 실패" 하나로 뭉개는 순간 이중 승인이 재현된다.
   */
  private sendAndSettle(request: PaymentRequest, report: TickReport): void {
    try {
      const result = this.approver.approve({
        requestId: request.id,
        amount: request.amount,
        method: request.method,
      });
      const confirmed = this.store.transition(
        request.id,
        'APPROVING',
        'APPROVED',
        'ApprovalConfirmed',
        { approvalNo: result.approvalNo },
        (r) => {
          r.approvalNo = result.approvalNo;
        },
      );
      if (this.settled(confirmed, report)) report.approved.push(request.id);
    } catch (error) {
      if (error instanceof ApproverTimeoutError) {
        // 대사를 껐다면 '모름'이라는 칸 자체가 없다. timeout 을 그 자리에서 실패로 접는다.
        if (!this.guards.reconcileQuery) {
          this.foldTimeout(request, report);
          return;
        }
        // 성공도 실패도 아니다. 승인됐는지 모르는 상태를 그대로 저장한다 -
        // 여기서 '실패'로 적으면 다음 재시도가 곧바로 이중 승인이 된다.
        const marked = this.store.transition(
          request.id,
          'APPROVING',
          'APPROVAL_UNKNOWN',
          'ApprovalTimedOut',
          { attempt: request.approveAttempts },
        );
        if (this.settled(marked, report)) report.unknown.push(request.id);
        return;
      }
      if (error instanceof ApproverDownError) {
        // 미승인이 확실하므로 재전송이 안전하다. 다만 무한히 반복하지는 않는다.
        if (this.atApproveLimit(request.approveAttempts)) {
          const quarantined = this.store.transition(
            request.id,
            'APPROVING',
            'APPROVAL_FAILED',
            'ApprovalQuarantined',
            { reason: '전송 시도 상한 도달', attempts: request.approveAttempts },
          );
          if (this.settled(quarantined, report)) report.quarantined.push(request.id);
        } else {
          const scheduled = this.store.transition(
            request.id,
            'APPROVING',
            'RECEIVED',
            'ApprovalRetryScheduled',
            { attempt: request.approveAttempts },
          );
          if (this.settled(scheduled, report)) report.retryScheduled.push(request.id);
        }
        return;
      }
      // 우리가 분류하지 못한 실패를 임의로 해석하지 않는다. 모르는 것은 모르는 채로 올린다.
      throw error;
    }
  }

  /**
   * 대사를 껐을 때의 timeout 처리. 성공/실패 2 값으로 접는 두 가지 방식을 모두 구현한다 -
   * 하나만 두면 "다른 쪽으로 접었으면 됐잖아"라는 반론이 남고, 그 반론이 이 데모의 논지다.
   * 어느 쪽도 PG 쪽 사실을 확인하지 않으므로 둘 다 틀린다. 틀리는 방향이 다를 뿐이다.
   */
  private foldTimeout(request: PaymentRequest, report: TickReport): void {
    if (this.unknownFallback === 'abandon') {
      const abandoned = this.store.transition(
        request.id,
        'APPROVING',
        'APPROVAL_FAILED',
        'ApprovalQuarantined',
        { reason: 'timeout 을 실패로 보고 포기', guard: 'reconcileQuery:off' },
      );
      if (this.settled(abandoned, report)) report.quarantined.push(request.id);
      return;
    }
    if (this.atApproveLimit(request.approveAttempts)) {
      const quarantined = this.store.transition(
        request.id,
        'APPROVING',
        'APPROVAL_FAILED',
        'ApprovalQuarantined',
        { reason: '전송 시도 상한 도달', attempts: request.approveAttempts },
      );
      if (this.settled(quarantined, report)) report.quarantined.push(request.id);
      return;
    }
    const scheduled = this.store.transition(
      request.id,
      'APPROVING',
      'RECEIVED',
      'ApprovalRetryScheduled',
      { reason: 'timeout 을 실패로 보고 재시도', guard: 'reconcileQuery:off' },
    );
    if (this.settled(scheduled, report)) report.retryScheduled.push(request.id);
  }

  /** 회수로 '모름'에 들어왔는데 조회를 쓸 수 없는 경우. 같은 두 방식으로 접는다. */
  private foldUnknown(request: PaymentRequest, report: TickReport): void {
    if (this.unknownFallback === 'abandon') {
      const abandoned = this.store.transition(
        request.id,
        'APPROVAL_UNKNOWN',
        'APPROVAL_FAILED',
        'ApprovalQuarantined',
        { reason: '조회 없이 포기', guard: 'reconcileQuery:off' },
      );
      if (this.settled(abandoned, report)) report.quarantined.push(request.id);
      return;
    }
    if (this.atApproveLimit(request.approveAttempts)) {
      const quarantined = this.store.transition(
        request.id,
        'APPROVAL_UNKNOWN',
        'APPROVAL_FAILED',
        'ApprovalQuarantined',
        { reason: '전송 시도 상한 도달', attempts: request.approveAttempts },
      );
      if (this.settled(quarantined, report)) report.quarantined.push(request.id);
      return;
    }
    const claim = this.store.transition(
      request.id,
      'APPROVAL_UNKNOWN',
      'APPROVING',
      'ApprovalStarted',
      { reason: '조회 없이 재전송', guard: 'reconcileQuery:off' },
      (r) => {
        r.approveAttempts += 1;
      },
    );
    if (!claim.ok) {
      report.claimSkipped.push({ requestId: request.id, actual: claim.actual });
      return;
    }
    report.resent.push(request.id);
    this.sendAndSettle(claim.request, report);
  }

  /**
   * 대사 - '모름'을 승인 조회로 푼다. 이 데모의 핵심이다.
   * 재전송은 미승인이 확인된 뒤에만 한다. 확인 없이 재전송하면 그것이 이중 승인이다.
   */
  private reconcile(requestId: string, report: TickReport): void {
    const request = this.store.getRequest(requestId);
    if (!request || request.status !== 'APPROVAL_UNKNOWN') return;

    // 대사가 꺼진 채로 '모름'에 도달하는 경로가 하나 있다 - 멈춘 클레임 회수다.
    // 조회를 쓸 수 없으므로 여기서도 같은 방식으로 접는다. 접지 않고 두면 아무도
    // 건드리지 않는 결제가 남고, 그건 화면에서 "막았다"처럼 보이는 교착이다.
    if (!this.guards.reconcileQuery) {
      this.foldUnknown(request, report);
      return;
    }

    let queried: { approved: boolean; approvalNo?: string };
    try {
      queried = this.approver.queryByRef(requestId);
    } catch {
      // 조회조차 실패했다 - 여전히 모름이다. 상태를 바꾸지 않고 실패 횟수만 센다.
      const failures = this.store.recordReconcileFailure(requestId);
      if (this.atReconcileLimit(failures)) {
        const quarantined = this.store.transition(
          requestId,
          'APPROVAL_UNKNOWN',
          'APPROVAL_FAILED',
          'ApprovalQuarantined',
          { reason: '승인 조회 실패 상한 도달', reconcileFailures: failures },
        );
        if (this.settled(quarantined, report)) report.quarantined.push(requestId);
      }
      return;
    }

    if (queried.approved) {
      // 이미 승인돼 있었다. 재전송하지 않고 확정만 한다 - 여기가 이중 승인을 막는 지점이다.
      const confirmed = this.store.transition(
        requestId,
        'APPROVAL_UNKNOWN',
        'APPROVED',
        'ApprovalReconciled',
        { outcome: 'already_approved', approvalNo: queried.approvalNo },
        (r) => {
          r.approvalNo = queried.approvalNo;
        },
      );
      if (this.settled(confirmed, report)) report.reconciledConfirmed.push(requestId);
      return;
    }

    // 미승인이 확인됐다 - 이제서야 재전송이 안전하다.
    if (this.atApproveLimit(request.approveAttempts)) {
      const quarantined = this.store.transition(
        requestId,
        'APPROVAL_UNKNOWN',
        'APPROVAL_FAILED',
        'ApprovalQuarantined',
        { reason: '전송 시도 상한 도달', attempts: request.approveAttempts },
      );
      if (this.settled(quarantined, report)) report.quarantined.push(requestId);
      return;
    }
    const claim = this.store.transition(
      requestId,
      'APPROVAL_UNKNOWN',
      'APPROVING',
      'ApprovalStarted',
      { reason: '미승인 확인 후 재전송' },
      (r) => {
        r.approveAttempts += 1;
      },
    );
    if (!claim.ok) {
      report.claimSkipped.push({ requestId, actual: claim.actual });
      return;
    }
    report.resent.push(requestId);
    this.sendAndSettle(claim.request, report);
  }
}

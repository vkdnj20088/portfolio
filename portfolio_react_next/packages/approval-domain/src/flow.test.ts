import { describe, expect, it } from 'vitest';
import { buildApp, createSequentialClock, type App } from './app';
import type { ApproverMode } from './approver';
import { ApprovalWorker, MAX_APPROVE_ATTEMPTS, MAX_RECONCILE_FAILURES } from './worker';
import { EventConsumer } from './consumer';
import type { ApprovalEventType, ApprovalStatus } from './types';

/**
 * 전 구간 흐름 시험. 원본 엔진에서는 실제 HTTP 로 돌렸지만 여기서는 전송 계층을 걷어내고
 * 핸들러를 직접 부른다 - 이 데모는 브라우저에서 도는 순수 엔진이라 띄울 서버가 없다.
 * 응답의 상태 코드와 본문 형태는 그대로 두었으므로 경계의 계약은 여전히 시험된다.
 * 워커만은 주기 실행 대신 tick()을 직접 호출한다 - 시간 주입이 없으면 같은 시험이
 * 매번 다르게 흐른다.
 */
interface PaymentView {
  requestId: string;
  status: ApprovalStatus;
  amount: number;
  method: string;
  approveAttempts: number;
  approvalNo: string | null;
  history: {
    seq: number;
    type: ApprovalEventType;
    at: string;
    detail: Record<string, unknown> | null;
  }[];
}

interface ErrorView {
  error: {
    code: string;
    field?: string;
    requestId?: string;
    currentStatus?: ApprovalStatus;
    message?: string;
  };
}

function launch(approverMode: ApproverMode = 'normal', opts: { staleClaimMs?: number } = {}): App {
  return buildApp({
    approverMode,
    clock: createSequentialClock(),
    staleClaimMs: opts.staleClaimMs,
  });
}

function receive(app: App, amount = 10_000, key?: string) {
  const res = app.handlers.receivePayment({ amount, method: 'card' }, key);
  return { status: res.status, body: res.body as { requestId: string; status: ApprovalStatus } };
}

function view(app: App, requestId: string) {
  const res = app.handlers.getPayment(requestId);
  return { status: res.status, body: res.body as PaymentView };
}

function failed(res: { status: number; body: unknown }) {
  return { status: res.status, body: res.body as ErrorView };
}

function types(app: App, requestId: string): ApprovalEventType[] {
  return view(app, requestId).body.history.map((e) => e.type);
}

describe('E0 - 정상 경로 전 구간', () => {
  it('접수 → 이벤트 발행 → PG 승인 요청 → 상태 전이 → 상태 조회까지 한 번에 통과한다', () => {
    const app = launch('normal');

    // 접수 (동기 경계: 201 = 접수 확정)
    const created = receive(app);
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('RECEIVED');
    const id = created.body.requestId;

    // 이벤트 발행 확인 - 접수 트랜잭션이 남긴 아웃박스 이벤트
    expect(types(app, id)).toEqual(['PaymentReceived']);

    // 승인 (비동기 경계: 워커 tick)
    const report = app.worker.tick();
    expect(report.approved).toEqual([id]);
    expect(app.approver.approvedCount()).toBe(1);

    // 상태 전이와 이력이 조회로 관찰된다
    const after = view(app, id);
    expect(after.status).toBe(200);
    expect(after.body.status).toBe('APPROVED');
    expect(after.body.approvalNo).toBe('A-1');
    expect(after.body.history.map((e) => e.type)).toEqual([
      'PaymentReceived',
      'ApprovalStarted',
      'ApprovalConfirmed',
    ]);
  });

  it('같은 멱등키로 재제출해도 결제 요청은 하나다 - 재시도 클라이언트 방어선이 진입점에서 작동한다', () => {
    const app = launch('normal');
    const first = receive(app, 50_000, 'k-1');
    const retry = receive(app, 50_000, 'k-1');

    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(retry.body.requestId).toBe(first.body.requestId);

    app.worker.tick();
    expect(app.approver.approvedCount()).toBe(1);
  });

  it('한 주기에 들어온 요청 여러 건이 각각 승인된다 - 피크에는 한 주기에 여러 건이 몰린다', () => {
    const app = launch('normal');
    const ids = [1, 2, 3].map((i) => receive(app, 10_000 * i).body.requestId);

    const report = app.worker.tick();
    expect(report.delivered).toBe(3);
    expect(report.approved).toEqual(ids);
    // 클레임 이후 전이가 조용히 실패한 자리가 없어야 한다 - 있으면 승인만 나가고
    // 상태가 안 남은 결제가 생긴다
    expect(report.settleConflicts).toEqual([]);
    expect(app.approver.approvedCount()).toBe(3);

    for (const id of ids) expect(view(app, id).body.status).toBe('APPROVED');
  });

  it('없는 요청 조회는 404 로 답한다 - 모르는 것을 빈 값으로 접지 않는다', () => {
    const app = launch('normal');
    const res = failed(app.handlers.getPayment('pay-없음'));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('REQUEST_NOT_FOUND');
  });

  it('검증 실패는 구조화 오류로 돌아온다 - 경계에서 걸러야 안쪽 계층이 단순해진다', () => {
    const app = launch('normal');
    const res = failed(app.handlers.receivePayment({ amount: -1, method: 'card' }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.field).toBe('amount');
  });
});

describe('T1 - timeout 이어도 PG 승인 건수가 1', () => {
  it('응답만 유실된 timeout 은 재전송이 아니라 조회로 확정된다 - 승인 1건, 요청 호출 1회', () => {
    const app = launch('timeout_after_approve');
    const id = receive(app).body.requestId;

    // 1차: PG 는 승인했지만 우리에게 응답이 오지 않았다
    const first = app.worker.tick();
    expect(first.unknown).toEqual([id]);
    expect(app.approver.approvedCount()).toBe(1);
    // 실패도 성공도 아닌 '모름'으로 남는다 - 화면이 아는 척하지 않는다
    expect(view(app, id).body.status).toBe('APPROVAL_UNKNOWN');

    // 2차: 재시도 시점이다. 재전송하지 않고 조회로 승인 여부를 확인한다
    const second = app.worker.tick();
    expect(second.reconciledConfirmed).toEqual([id]);
    expect(second.resent).toEqual([]);

    expect(app.approver.approvedCount()).toBe(1);
    // 메커니즘을 직접 본다 - 결과 상태만이 아니라 "재전송을 호출하지 않았다"를 확인한다
    expect(app.approver.approveCalls).toBe(1);
    expect(app.approver.queryCalls).toBe(1);

    const final = view(app, id).body;
    expect(final.status).toBe('APPROVED');
    expect(final.approvalNo).toBe('A-1');
    expect(final.history.map((e) => e.type)).toEqual([
      'PaymentReceived',
      'ApprovalStarted',
      'ApprovalTimedOut',
      'ApprovalReconciled',
    ]);
  });

  it('주기를 여러 번 더 돌려도 승인 건수는 1 에 머문다 - 확정된 결제는 다시 집히지 않는다', () => {
    const app = launch('timeout_after_approve');
    const id = receive(app).body.requestId;

    for (let i = 0; i < 5; i += 1) app.worker.tick();

    expect(app.approver.approvedCount()).toBe(1);
    expect(app.approver.approveCalls).toBe(1);
    const final = view(app, id).body;
    expect(final.status).toBe('APPROVED');
    expect(final.approveAttempts).toBe(1);
  });

  it('승인 전에 끊긴 timeout 은 미승인을 확인한 뒤 재전송한다 - 대사가 두 경우를 실제로 가른다', () => {
    // 앞 시험과 증상(timeout 예외)은 같지만 PG 쪽 사실은 반대다.
    // 조회 없이 "timeout 이면 재전송"이나 "timeout 이면 포기" 어느 쪽으로 뭉쳐도 틀린다.
    const app = launch('timeout_before_approve');
    const id = receive(app).body.requestId;

    app.worker.tick();
    expect(app.approver.approvedCount()).toBe(0);
    expect(view(app, id).body.status).toBe('APPROVAL_UNKNOWN');

    // PG 가 회복됐다
    app.approver.mode = 'normal';
    const second = app.worker.tick();
    expect(second.resent).toEqual([id]);
    expect(second.approved).toEqual([id]);

    // 재전송했지만 승인은 여전히 1건이다 - 앞선 시도는 승인되지 않았기 때문
    expect(app.approver.approvedCount()).toBe(1);
    expect(app.approver.approveCalls).toBe(2);
    const final = view(app, id).body;
    expect(final.status).toBe('APPROVED');
    expect(final.approveAttempts).toBe(2);
  });
});

describe('T2 - 같은 결제가 두 번 처리 시도되어도 승인 건수가 1', () => {
  it('아웃박스가 같은 이벤트를 한 배치에 두 번 전달해도 승인 요청은 한 번만 나간다', () => {
    const app = launch('normal');
    const id = receive(app).body.requestId;

    // at-least-once 재전달을 강제한다. 워커는 이 중복을 스스로 걸러내지 않는다 -
    // 걸러내는 주체는 저장소의 조건부 전이여야 한다. 워커 안의 메모리로 막으면
    // 워커가 두 대일 때 그 방어선은 존재하지 않는 것과 같기 때문이다.
    app.store.forceRedeliverNextRead();
    const report = app.worker.tick();

    expect(report.delivered).toBe(2); // 같은 요청이 두 번 전달됐다
    expect(report.approved).toEqual([id]); // 승인 요청은 한 번
    expect(report.claimSkipped).toHaveLength(1); // 두 번째 시도는 클레임에서 막혔다
    expect(report.claimSkipped[0]?.actual).toBe('APPROVED');

    expect(app.approver.approvedCount()).toBe(1);
    expect(app.approver.approveCalls).toBe(1);

    const final = view(app, id).body;
    expect(final.status).toBe('APPROVED');
    expect(final.approveAttempts).toBe(1);
    // 이력에도 승인 시작이 한 번만 남는다 - 막힌 시도는 흔적을 남기지 않는다
    expect(final.history.filter((e) => e.type === 'ApprovalStarted')).toHaveLength(1);
  });

  it('처리 후 커서를 못 남기고 죽어 같은 이벤트를 다시 받아도 승인이 늘지 않는다', () => {
    const app = launch('normal');
    const id = receive(app).body.requestId;

    app.worker.tick(); // 정상 처리 완료
    expect(app.approver.approvedCount()).toBe(1);

    // 커서 커밋 전에 죽었다가 재기동한 상황: 직전 배치가 다시 전달된다
    app.store.forceRedeliverNextRead();
    const replay = app.worker.tick();

    expect(replay.delivered).toBe(1);
    expect(replay.claimSkipped).toHaveLength(1);
    expect(app.approver.approvedCount()).toBe(1);
    expect(app.approver.approveCalls).toBe(1);
    expect(view(app, id).body.status).toBe('APPROVED');
  });

  it('워커 두 대가 같은 결제를 동시에 집어도 한 대만 승인 요청한다 - 중복의 진짜 출처는 이쪽이다', () => {
    const app = launch('normal');
    const id = receive(app).body.requestId;

    // 두 번째 워커는 자기 커서를 0 에서 시작하므로 같은 이벤트를 받는다.
    // 스위치 없이 만들어지는 중복이고, 운영에서 워커를 두 대 띄우면 실제로 이렇게 된다.
    const second = new ApprovalWorker(app.store, app.approver, { now: app.clock.now });
    const firstReport = app.worker.tick();
    const secondReport = second.tick();

    expect(firstReport.approved).toEqual([id]);
    expect(secondReport.approved).toEqual([]);
    expect(secondReport.claimSkipped).toHaveLength(1);
    expect(secondReport.claimSkipped[0]?.actual).toBe('APPROVED');

    expect(app.approver.approvedCount()).toBe(1);
    expect(app.approver.approveCalls).toBe(1);
  });

  it('중복 전달과 timeout 이 겹쳐도 승인은 1건이다 - 두 방어선이 서로를 무너뜨리지 않는다', () => {
    // T1 의 중복(재시도 × 이미 승인)과 T2 의 중복(재전달)이 한 결제에 동시에 오는 경우다.
    const app = launch('timeout_after_approve');
    const id = receive(app).body.requestId;

    app.store.forceRedeliverNextRead();
    const first = app.worker.tick(); // 두 번 전달 → 한 번만 요청 → timeout
    expect(first.delivered).toBe(2);
    expect(first.unknown).toEqual([id]);
    expect(app.approver.approvedCount()).toBe(1);

    app.store.forceRedeliverNextRead();
    const second = app.worker.tick(); // 이미 지나간 이벤트가 다시 온다
    expect(second.claimSkipped).toHaveLength(1); // 상태가 진행돼 있어 클레임이 막는다
    // 재전달이 섞인 주기에는 대사를 한 번 미룬다. 같은 결제를 한 tick 에 두 번 건드리지
    // 않는 규칙 때문인데, 안전한 쪽으로 미루는 선택이라 그대로 둔다.
    expect(second.reconciledConfirmed).toEqual([]);

    app.worker.tick(); // 다음 주기에 대사 → 재전송 없이 확정

    expect(app.approver.approvedCount()).toBe(1);
    expect(app.approver.approveCalls).toBe(1);
    expect(view(app, id).body.status).toBe('APPROVED');
  });
});

describe('취소 흐름 - 승인 착수 이전에만 가능하다', () => {
  it('착수 전 취소는 성공하고, 그 뒤 주기가 돌아도 PG 로 나가지 않는다', () => {
    const app = launch('normal');
    const id = receive(app).body.requestId;

    const cancelled = app.handlers.cancelPayment(id);
    expect(cancelled.status).toBe(200);
    expect((cancelled.body as { status: ApprovalStatus }).status).toBe('CANCELLED');

    // 취소를 상태로만 남기고 승인 요청을 못 막으면 돈이 나간다 - 실제로 안 나가는지 확인한다
    const report = app.worker.tick();
    expect(report.approved).toEqual([]);
    expect(report.claimSkipped[0]?.actual).toBe('CANCELLED');
    expect(app.approver.approvedCount()).toBe(0);
    expect(app.approver.approveCalls).toBe(0);
  });

  it('승인이 착수된 뒤의 취소는 409 로 거절되고 현재 상태를 알려준다', () => {
    const app = launch('normal');
    const id = receive(app).body.requestId;

    app.worker.tick(); // 승인 완료

    const rejected = failed(app.handlers.cancelPayment(id));
    expect(rejected.status).toBe(409);
    expect(rejected.body.error.code).toBe('CANCEL_WINDOW_CLOSED');
    expect(rejected.body.error.currentStatus).toBe('APPROVED');
    expect(view(app, id).body.status).toBe('APPROVED');
  });

  it('없는 요청의 취소는 404 이고, 거절 메시지가 현재 상태를 단정하지 않는다', () => {
    const app = launch('normal');
    expect(app.handlers.cancelPayment('pay-없음').status).toBe(404);

    // 격리된 결제는 PG 에 승인됐는지조차 모르는 상태다. 여기에 "승인이 끝나서 취소 불가"라고
    // 답하면 화면이 사실이 아닌 것을 말하게 된다.
    const downApp = launch('down');
    const id = receive(downApp).body.requestId;
    for (let i = 0; i < MAX_APPROVE_ATTEMPTS; i += 1) downApp.worker.tick();

    const rejected = failed(downApp.handlers.cancelPayment(id));
    expect(rejected.status).toBe(409);
    expect(rejected.body.error.currentStatus).toBe('APPROVAL_FAILED');
    expect(rejected.body.error.message).toContain('PG 확인이 필요하다');
  });

  it('취소도 이벤트로 남아 정산이 소비한다 - 취소를 모르면 정산이 틀어진다', () => {
    const app = launch('normal');
    const settlement = new EventConsumer('정산', app.store, [
      'ApprovalConfirmed',
      'PaymentCancelled',
    ]);
    const id = receive(app).body.requestId;

    app.handlers.cancelPayment(id);
    expect(settlement.poll().map((e) => e.type)).toEqual(['PaymentCancelled']);
  });

  it('착수와 취소가 같은 순간에 겹치면 한쪽만 이긴다 - 승자는 조건부 전이가 정한다', () => {
    const app = launch('normal');
    const id = receive(app).body.requestId;

    // 승인 처리기가 클레임을 먼저 쥔 직후에 취소 요청이 도착한 상황
    app.store.transition(id, 'RECEIVED', 'APPROVING', 'ApprovalStarted', undefined, (r) => {
      r.approveAttempts += 1;
    });
    const late = failed(app.handlers.cancelPayment(id));

    expect(late.status).toBe(409);
    expect(late.body.error.currentStatus).toBe('APPROVING');
    // 진 쪽이 상태를 덮어쓰지 않는다 - 취소 시도는 흔적도 남기지 않는다
    expect(types(app, id)).toEqual(['PaymentReceived', 'ApprovalStarted']);
  });
});

describe('소비자 fan-out - 큐를 쓰지 않기로 한 근거의 검증', () => {
  it('팀마다 관심 이벤트와 커서가 따로 돌고, 서로의 소비에 영향을 주지 않는다', () => {
    const app = launch('normal');
    const risk = new EventConsumer('이상거래', app.store, ['PaymentReceived']);
    const settlement = new EventConsumer('정산', app.store, [
      'ApprovalConfirmed',
      'ApprovalReconciled',
    ]);

    const id = receive(app).body.requestId;

    // 접수 시점에 이상거래는 볼 것이 있고 정산은 아직 없다
    expect(risk.poll().map((e) => e.type)).toEqual(['PaymentReceived']);
    expect(settlement.poll()).toEqual([]);

    app.worker.tick(); // 승인 확정

    // 이제 정산이 볼 것이 생겼고, 이상거래는 새로 볼 것이 없다 - 커서가 독립적이다
    expect(settlement.poll().map((e) => e.type)).toEqual(['ApprovalConfirmed']);
    expect(risk.poll()).toEqual([]);
    expect(risk.received).toHaveLength(1);
    expect(settlement.received[0]?.requestId).toBe(id);
  });

  it('나중에 붙은 팀도 과거 전체를 처음부터 읽는다 - 이력을 전량 보존하기 때문', () => {
    const app = launch('normal');
    receive(app);
    app.worker.tick();

    // 다른 소비자들이 이미 다 읽어간 뒤에 새 팀(상담)이 합류한다.
    // 큐였다면 이미 소비된 메시지라 못 읽지만, 이력이 남아 있으므로 리플레이가 된다.
    const support = new EventConsumer('상담', app.store, [
      'PaymentReceived',
      'ApprovalStarted',
      'ApprovalConfirmed',
    ]);
    expect(support.poll().map((e) => e.type)).toEqual([
      'PaymentReceived',
      'ApprovalStarted',
      'ApprovalConfirmed',
    ]);
    expect(support.poll()).toEqual([]); // 두 번째 폴링은 새 것만
  });
});

describe('승인 도중 워커가 죽은 결제의 회수', () => {
  /** 클레임만 하고 죽은 워커를 흉내낸다 - 저장소에는 APPROVING 만 남고 아무도 처리하지 않는다. */
  function simulateDeadWorkerClaim(app: App, requestId: string): void {
    app.store.transition(requestId, 'RECEIVED', 'APPROVING', 'ApprovalStarted', undefined, (r) => {
      r.approveAttempts += 1;
    });
  }

  it('전송 전에 죽었으면 회수 후 재전송되어 결제가 살아난다 - 멈춘 결제를 방치하지 않는다', () => {
    const app = launch('normal', { staleClaimMs: 0 });
    const id = receive(app).body.requestId;
    simulateDeadWorkerClaim(app, id);

    app.worker.tick(); // 아웃박스로 전달되지만 이미 APPROVING 이라 클레임이 막힌다
    const reclaimTick = app.worker.tick();
    expect(reclaimTick.reclaimed).toEqual([id]);
    // 회수 목적지는 RECEIVED 가 아니라 '모름'이다 - 전송 전에 죽었는지 후에 죽었는지 모르기 때문
    expect(view(app, id).body.status).toBe('APPROVAL_UNKNOWN');

    const recoverTick = app.worker.tick(); // 대사 → 미승인 확인 → 재전송
    expect(recoverTick.resent).toEqual([id]);
    expect(view(app, id).body.status).toBe('APPROVED');
    expect(app.approver.approvedCount()).toBe(1);
  });

  it('PG 가 이미 승인한 뒤 죽었어도 재전송하지 않는다 - 회수를 접수로 하지 않은 이유', () => {
    const app = launch('normal', { staleClaimMs: 0 });
    const id = receive(app).body.requestId;
    simulateDeadWorkerClaim(app, id);
    // PG 는 승인 요청을 받았는데, 그 사실을 우리 저장소에 남기기 직전에 워커가 죽었다
    app.approver.approve({ requestId: id, amount: 10_000, method: 'card' });
    expect(app.approver.approvedCount()).toBe(1);

    for (let i = 0; i < 3; i += 1) app.worker.tick();

    const final = view(app, id).body;
    expect(final.status).toBe('APPROVED');
    // 회수했지만 다시 보내지는 않았다. 접수로 되돌렸다면 여기서 2가 됐을 것이다.
    expect(app.approver.approvedCount()).toBe(1);
    expect(app.approver.approveCalls).toBe(1);
    const seen = final.history.map((e) => e.type);
    expect(seen).toContain('ApprovalClaimReclaimed');
    expect(seen.at(-1)).toBe('ApprovalReconciled');
  });
});

describe('T3 - 반복 실패 시 무한 재시도하지 않고 격리된다', () => {
  it('연결 실패가 계속되면 시도 상한에서 멈추고 격리된다 - 주기를 더 돌려도 시도가 늘지 않는다', () => {
    const app = launch('down');
    const id = receive(app).body.requestId;

    // 한 주기에 한 번씩만 시도한다 - 재시도 간격이 없으면 상한이 순식간에 소진된다
    for (let i = 1; i < MAX_APPROVE_ATTEMPTS; i += 1) {
      const report = app.worker.tick();
      expect(report.retryScheduled).toEqual([id]);
      expect(view(app, id).body.status).toBe('RECEIVED');
    }

    const last = app.worker.tick();
    expect(last.quarantined).toEqual([id]);

    const quarantined = view(app, id).body;
    expect(quarantined.status).toBe('APPROVAL_FAILED');
    expect(quarantined.approveAttempts).toBe(MAX_APPROVE_ATTEMPTS);
    expect(app.approver.approveCalls).toBe(MAX_APPROVE_ATTEMPTS);
    expect(app.approver.approvedCount()).toBe(0); // 연결 실패는 미승인이 확실하다

    // 무한 재시도를 하지 않는다는 것을 호출 횟수로 직접 확인한다
    for (let i = 0; i < 10; i += 1) app.worker.tick();
    expect(app.approver.approveCalls).toBe(MAX_APPROVE_ATTEMPTS);
    expect(view(app, id).body.status).toBe('APPROVAL_FAILED');

    // 왜 멈췄는지가 이력에 남는다 - 상담이 마지막 사실을 읽을 수 있어야 한다
    const lastEvent = quarantined.history.at(-1);
    expect(lastEvent?.type).toBe('ApprovalQuarantined');
    expect(lastEvent?.detail?.['reason']).toBe('전송 시도 상한 도달');
  });

  it('승인 조회조차 계속 실패하면 모름인 채로 격리된다 - 승인됐을 수 있으므로 재전송하지 않는다', () => {
    const app = launch('timeout_after_approve');
    const id = receive(app).body.requestId;

    app.worker.tick(); // 승인은 됐고 응답만 유실 → 모름
    expect(app.approver.approvedCount()).toBe(1);
    expect(view(app, id).body.status).toBe('APPROVAL_UNKNOWN');

    // PG 가 아예 죽어서 조회도 안 된다
    app.approver.mode = 'down';
    for (let i = 1; i < MAX_RECONCILE_FAILURES; i += 1) {
      app.worker.tick();
      expect(view(app, id).body.status).toBe('APPROVAL_UNKNOWN');
    }
    const last = app.worker.tick();
    expect(last.quarantined).toEqual([id]);

    const quarantined = view(app, id).body;
    expect(quarantined.status).toBe('APPROVAL_FAILED');
    // 격리는 "승인 실패 확정"이 아니다. PG 에는 승인이 남아 있고, 우리가 확인을 못 했을 뿐이다.
    expect(app.approver.approvedCount()).toBe(1);
    // 확인하지 못한 채로 재전송하지 않았다는 것이 핵심이다 - 그랬다면 두 번 청구됐다
    expect(app.approver.approveCalls).toBe(1);
    expect(quarantined.history.at(-1)?.detail?.['reason']).toBe('승인 조회 실패 상한 도달');

    // 실패한 결제일수록 이력이 온전해야 한다. 상담이 "무엇을 시도했고 어디서 멈췄는지"를
    // 이 목록만 보고 답할 수 있어야 하므로, 실패 경로에서도 전량 보존을 확인한다.
    expect(quarantined.history.map((e) => e.type)).toEqual([
      'PaymentReceived',
      'ApprovalStarted',
      'ApprovalTimedOut',
      'ApprovalReconciled', // 조회 실패 1
      'ApprovalReconciled', // 조회 실패 2
      'ApprovalReconciled', // 조회 실패 3
      'ApprovalQuarantined',
    ]);
  });

  it('재전송 경로에도 같은 시도 상한이 걸린다 - 대사를 통과했다고 무한히 보내지 않는다', () => {
    // 승인 전에 계속 끊기는 PG. 대사는 매번 "미승인"이라고 답하므로 재전송이 안전하지만,
    // 안전하다고 해서 끝없이 보내도 되는 것은 아니다. 클레임 경로와 재전송 경로 두 군데
    // 모두에 상한이 걸려 있는지를 확인한다.
    const app = launch('timeout_before_approve');
    const id = receive(app).body.requestId;

    for (let i = 0; i < 10; i += 1) app.worker.tick();

    const final = view(app, id).body;
    expect(final.status).toBe('APPROVAL_FAILED');
    expect(final.approveAttempts).toBe(MAX_APPROVE_ATTEMPTS);
    expect(app.approver.approveCalls).toBe(MAX_APPROVE_ATTEMPTS);
    expect(app.approver.approvedCount()).toBe(0);
    expect(final.history.at(-1)?.detail?.['reason']).toBe('전송 시도 상한 도달');
  });

  it('격리된 결제는 재전달이 와도 다시 승인 요청되지 않는다 - 종료 상태라 클레임이 열리지 않는다', () => {
    const app = launch('down');
    const id = receive(app).body.requestId;

    for (let i = 0; i < MAX_APPROVE_ATTEMPTS; i += 1) app.worker.tick();
    expect(view(app, id).body.status).toBe('APPROVAL_FAILED');

    app.approver.mode = 'normal'; // PG 가 회복돼도 자동으로 되살아나지 않는다
    app.store.forceRedeliverNextRead();
    const replay = app.worker.tick();

    expect(replay.claimSkipped[0]?.actual).toBe('APPROVAL_FAILED');
    expect(replay.approved).toEqual([]);
    expect(app.approver.approvedCount()).toBe(0);
    expect(app.approver.approveCalls).toBe(MAX_APPROVE_ATTEMPTS);
  });
});

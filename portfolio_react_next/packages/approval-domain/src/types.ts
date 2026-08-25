/**
 * 결제 승인 요청의 상태.
 *
 * 성공/실패 2 값으로 두면 timeout 을 어느 쪽으로 접어도 틀린다 - 실패로 접고 재시도하면
 * 이중 승인이 나고, 실패로 접고 포기하면 이미 승인된 결제를 잃는다. 그래서 '모름'을
 * 세 번째 값으로 만들었다. 이 데모 전체가 그 한 칸을 증명하려고 있다.
 */
export type ApprovalStatus =
  | 'RECEIVED' // 접수 확정, 승인 요청 대기 (재시도 대기도 이 상태로 돌아온다)
  | 'APPROVING' // 승인 클레임 획득, PG 로 전송 중
  | 'APPROVAL_UNKNOWN' // timeout - PG 가 승인했는지 모른다. 성공도 실패도 아니다
  | 'APPROVED' // 승인 확인됨
  | 'APPROVAL_FAILED' // 격리: 자동 재시도 중단, 사람 확인 대상
  | 'CANCELLED'; // 승인 착수 전 취소

export interface PaymentRequest {
  id: string;
  /** 원 단위 정수. 소수를 쓰지 않는 이유는 금액 비교가 부동소수 오차를 타면 안 되기 때문이다. */
  amount: number;
  method: string;
  status: ApprovalStatus;
  // 시도 횟수를 요청 행에 두는 이유: 워커를 무상태로 만들기 위해서다.
  // 워커가 죽어도 재기동하면 저장소만 보고 어디까지 갔는지 알 수 있다.
  approveAttempts: number;
  reconcileFailures: number;
  approvalNo?: string;
  createdAt: string;
  updatedAt: string;
}

export type ApprovalEventType =
  | 'PaymentReceived'
  | 'ApprovalStarted'
  | 'ApprovalConfirmed'
  | 'ApprovalTimedOut'
  | 'ApprovalReconciled'
  | 'ApprovalRetryScheduled'
  | 'ApprovalClaimReclaimed'
  | 'ApprovalQuarantined'
  | 'PaymentCancelled';

export interface ApprovalEvent {
  seq: number;
  requestId: string;
  type: ApprovalEventType;
  at: string;
  detail?: Record<string, unknown>;
}

// 실패를 예외로 흘리지 않고 구조화해서 돌려준다. 특히 INVALID_TRANSITION 은
// "다른 처리자가 선점했다"는 정상적인 사실이지 오류가 아니므로, 호출자가
// 종류를 보고 판단할 수 있어야 한다.
export type TransitionResult =
  | { ok: true; request: PaymentRequest }
  | {
      ok: false;
      reason: 'NOT_FOUND' | 'INVALID_TRANSITION';
      requestId: string;
      expected: ApprovalStatus;
      actual?: ApprovalStatus;
    };

/** 시간과 ID 를 주입한다. 난수를 쓰지 않으므로 이 둘만 고정하면 실행이 결정적이다. */
export interface Clock {
  now: () => string;
  newId: () => string;
}

/** 응답이 오지 않았다 - PG 가 승인했는지 모른다. 실패가 아니라 '모름'이다. */
export class ApproverTimeoutError extends Error {
  constructor() {
    super('PG 응답 없음 (timeout) - 승인 여부를 알 수 없다');
  }
}

/** 연결 자체가 실패했다 - 승인되지 않았음이 확실하다. 위 timeout 과는 다른 종류의 실패다. */
export class ApproverDownError extends Error {
  constructor() {
    super('PG 연결 실패 - 승인되지 않았음');
  }
}

/**
 * timeout 을 두 종류로 나눈 이유: 호출자 입장에서는 둘 다 똑같이 "응답 없음"이지만,
 * PG 쪽 사실은 정반대다(승인됨 / 승인 안 됨). 우리 코드는 이 둘을 구분할 수 없으므로
 * 추측하지 않고 조회로 확인해야 한다는 것이 이 데모의 논지이고,
 * 그 논지를 증명하려면 스텁이 두 경우를 모두 만들 수 있어야 한다.
 */
export type ApproverMode =
  | 'normal'
  | 'timeout_after_approve' // 승인은 났고 응답만 유실
  | 'timeout_before_approve' // 승인 전에 끊김 - 재전송이 안전한 경우
  | 'down'; // 연결 실패, 미승인 확실

export const APPROVER_MODE_LABEL: Record<ApproverMode, string> = {
  normal: '정상',
  timeout_after_approve: '승인 후 응답 유실',
  timeout_before_approve: '승인 전 끊김',
  down: '연결 실패',
};

export interface ApproveRequest {
  requestId: string;
  amount: number;
  method: string;
}

/**
 * 가짜 PG 승인 API. 통제 불가한 외부의 관찰된 동작만 재현한다.
 *
 * 일부러 중복 제거를 하지 않는다: 이 데모의 전제가 "같은 결제를 다시 보내면 PG 는 또
 * 승인한다"이다. 스텁이 알아서 걸러 주면 증명하려는 것 자체가 사라진다. PG 는 통제 불가
 * 외부이므로, PG 가 우리를 지켜 준다는 가정 위에 안전성을 세우면 안 된다.
 *
 * 조회(queryByRef)는 승인 요청(approve)과 별개의 호출이라, 승인 요청이 timeout 이어도
 * 조회는 정상 동작한다. "그 순간 그 요청의 응답만 유실됐다"가 사고의 실제 모습이다.
 */
export class ApproverStub {
  private approvals: { requestId: string; approvalNo: string }[] = [];
  /** 우리가 승인 요청을 몇 번 호출했는지. "재전송하지 않았다"를 직접 확인하는 수단. */
  approveCalls = 0;
  queryCalls = 0;

  constructor(public mode: ApproverMode = 'normal') {}

  approve(req: ApproveRequest): { approvalNo: string } {
    this.approveCalls += 1;
    if (this.mode === 'down') throw new ApproverDownError();
    if (this.mode === 'timeout_before_approve') throw new ApproverTimeoutError();

    const approvalNo = `A-${this.approvals.length + 1}`;
    this.approvals.push({ requestId: req.requestId, approvalNo });
    if (this.mode === 'timeout_after_approve') throw new ApproverTimeoutError();
    return { approvalNo };
  }

  /**
   * 우리 거래번호로 승인 여부를 조회한다. 업계에서 '승인 조회'라 부르는 그 호출이고,
   * 조회가 "승인됨"이라고 답했는데 그 결제를 되돌려야 할 때 쓰는 것이 '망취소'다.
   * 이 조회가 존재한다는 것이 재시도 안전성의 유일한 근거다 - 가정이 깨지면 해법도 깨진다.
   */
  queryByRef(requestId: string): { approved: boolean; approvalNo?: string } {
    this.queryCalls += 1;
    if (this.mode === 'down') throw new ApproverDownError();
    const hit = this.approvals.find((a) => a.requestId === requestId);
    return hit ? { approved: true, approvalNo: hit.approvalNo } : { approved: false };
  }

  /** PG 쪽에 실제로 남은 승인 건수. 이 데모의 판정 수치다. */
  approvedCount(): number {
    return this.approvals.length;
  }
}

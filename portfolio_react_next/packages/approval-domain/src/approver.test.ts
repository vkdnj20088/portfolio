import { describe, expect, it } from 'vitest';
import { ApproverDownError, ApproverStub, ApproverTimeoutError } from './approver';

const REQ = { requestId: 'pay-1', amount: 10_000, method: 'card' };

describe('가짜 PG (이중 승인 재현 장치)', () => {
  it('승인 후 유실 timeout 은 승인을 마친 뒤 예외를 던진다 - timeout 은 실패가 아니라 응답 유실이라서', () => {
    const approver = new ApproverStub('timeout_after_approve');
    expect(() => approver.approve(REQ)).toThrow(ApproverTimeoutError);
    expect(approver.approvedCount()).toBe(1);
    expect(approver.queryByRef('pay-1').approved).toBe(true);
  });

  it('승인 전 유실 timeout 은 같은 예외를 던지지만 승인은 없다 - 호출자는 둘을 구분할 수 없다는 것이 전제', () => {
    const approver = new ApproverStub('timeout_before_approve');
    expect(() => approver.approve(REQ)).toThrow(ApproverTimeoutError);
    expect(approver.approvedCount()).toBe(0);
    expect(approver.queryByRef('pay-1').approved).toBe(false);
  });

  it('연결 실패는 승인 없이 예외를 던진다 - 미승인이 확실한 실패는 timeout 과 다른 종류라서', () => {
    const approver = new ApproverStub('down');
    expect(() => approver.approve(REQ)).toThrow(ApproverDownError);
    expect(approver.approvedCount()).toBe(0);
  });

  it('중복 제거를 하지 않는다 - 같은 결제를 다시 보내면 또 승인한다(사고의 전제)', () => {
    const approver = new ApproverStub('normal');
    approver.approve(REQ);
    approver.approve(REQ);
    expect(approver.approvedCount()).toBe(2);
  });
});

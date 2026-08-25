import { describe, expect, it } from 'vitest';
import { MemoryStore } from './store';
import { createSequentialClock } from './app';

function store(): MemoryStore {
  return new MemoryStore(createSequentialClock());
}

describe('저장소 조건부 전이 (이중 승인의 저장소 방어선)', () => {
  it('기대 상태가 다르면 아무것도 바꾸지 않고 구조화 실패를 돌려준다 - 선점은 오류가 아니라 판단 대상이기 때문', () => {
    const s = store();
    const { request } = s.receive({ amount: 10_000, method: 'card' });

    const first = s.transition(request.id, 'RECEIVED', 'APPROVING', 'ApprovalStarted');
    expect(first.ok).toBe(true);

    // 같은 클레임을 다시 시도 - 두 번째 처리자를 흉내낸다
    const second = s.transition(request.id, 'RECEIVED', 'APPROVING', 'ApprovalStarted');
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.reason).toBe('INVALID_TRANSITION');
      expect(second.actual).toBe('APPROVING');
    }
    // 실패한 시도는 흔적(상태 변경·이벤트)을 남기지 않는다
    expect(s.getRequest(request.id)?.status).toBe('APPROVING');
    expect(s.getHistory(request.id).filter((e) => e.type === 'ApprovalStarted')).toHaveLength(1);
  });

  it('전이표에 없는 전이 호출은 throw 한다 - 경합(구조화 실패)과 코드 버그는 다른 종류의 실패라서', () => {
    const s = store();
    const { request } = s.receive({ amount: 10_000, method: 'card' });
    expect(() => s.transition(request.id, 'RECEIVED', 'APPROVED', 'ApprovalConfirmed')).toThrow(
      /전이표 위반/,
    );
  });

  it('모든 전이는 이벤트로 남는다 - 이력 전량 보존', () => {
    const s = store();
    const { request } = s.receive({ amount: 10_000, method: 'card' });
    s.transition(request.id, 'RECEIVED', 'APPROVING', 'ApprovalStarted');
    s.transition(request.id, 'APPROVING', 'APPROVED', 'ApprovalConfirmed');

    const types = s.getHistory(request.id).map((e) => e.type);
    expect(types).toEqual(['PaymentReceived', 'ApprovalStarted', 'ApprovalConfirmed']);
    const seqs = s.getHistory(request.id).map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  });
});

describe('멱등키 (클라이언트 재제출 방어선)', () => {
  it('같은 키의 재제출은 새 요청을 만들지 않고 동일 요청을 돌려준다', () => {
    const s = store();
    const first = s.receive({ amount: 10_000, method: 'card' }, 'key-1');
    const retry = s.receive({ amount: 10_000, method: 'card' }, 'key-1');

    expect(first.created).toBe(true);
    expect(retry.created).toBe(false);
    expect(retry.request.id).toBe(first.request.id);
    expect(s.requestsIn('RECEIVED')).toHaveLength(1);
  });
});

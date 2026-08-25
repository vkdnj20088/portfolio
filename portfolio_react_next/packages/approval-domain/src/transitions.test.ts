import { describe, expect, it } from 'vitest';
import { canTransition } from './transitions';

describe('상태 전이표', () => {
  it('역행 전이는 거부된다 - 순서가 뒤집히면 취소 규칙이 무너지기 때문', () => {
    expect(canTransition('APPROVED', 'RECEIVED')).toBe(false);
    expect(canTransition('APPROVED', 'APPROVING')).toBe(false);
    expect(canTransition('CANCELLED', 'APPROVING')).toBe(false);
    expect(canTransition('APPROVAL_FAILED', 'APPROVING')).toBe(false);
  });

  it('timeout 복귀 경로는 허용된다 - 모름은 확정이나 재전송으로만 풀린다', () => {
    expect(canTransition('APPROVING', 'APPROVAL_UNKNOWN')).toBe(true);
    expect(canTransition('APPROVAL_UNKNOWN', 'APPROVED')).toBe(true);
    expect(canTransition('APPROVAL_UNKNOWN', 'APPROVING')).toBe(true);
    // 모름에서 접수로 되돌아가는 문은 없다. 열어 두면 조회 없는 재전송이 가능해진다.
    expect(canTransition('APPROVAL_UNKNOWN', 'RECEIVED')).toBe(false);
  });
});

import type { ApprovalStatus } from './types';

// 허용 전이를 if 분기가 아니라 표로 고정한 이유: "승인 착수 이후에는 취소를 약속할 수 없다",
// "상태가 역행하면 안 된다"를 데이터로 못박아 두면, 나중에 전이를 추가하다 실수로
// 역행 경로를 여는 일이 생길 수 없다.
const ALLOWED: Record<ApprovalStatus, readonly ApprovalStatus[]> = {
  RECEIVED: ['APPROVING', 'CANCELLED'],
  APPROVING: ['APPROVED', 'APPROVAL_UNKNOWN', 'RECEIVED', 'APPROVAL_FAILED'],
  // UNKNOWN 에서 APPROVING 으로 돌아가는 경로는 "조회로 미승인을 확인한 뒤의 재전송"이다.
  APPROVAL_UNKNOWN: ['APPROVED', 'APPROVING', 'APPROVAL_FAILED'],
  APPROVED: [], // 매입·정산 이후 상태는 이 데모의 범위 밖이다
  APPROVAL_FAILED: [],
  CANCELLED: [],
};

export function canTransition(from: ApprovalStatus, to: ApprovalStatus): boolean {
  return ALLOWED[from].includes(to);
}

/** 화면이 상태 이름을 직접 쓰지 않게 한다 - 코드의 상태와 사람이 읽는 말을 한 곳에서 잇는다. */
export const STATUS_LABEL: Record<ApprovalStatus, string> = {
  RECEIVED: '접수됨',
  APPROVING: '승인 요청 중',
  APPROVAL_UNKNOWN: '모름',
  APPROVED: '승인됨',
  APPROVAL_FAILED: '격리됨',
  CANCELLED: '취소됨',
};

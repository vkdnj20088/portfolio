/**
 * 방어선을 하나씩 끌 수 있게 만든 이유.
 *
 * 켠 화면만 보여 주면 "원래 안 일어날 일 아니냐"는 의심을 지울 수 없다. 껐을 때 PG 승인
 * 건수가 실제로 2가 되는 것을 같은 화면에서 보여야 막았다는 말에 대조군이 생긴다.
 * 원본 엔진에는 끄는 경로가 없었다 - 이 파일이 이 데모에서 새로 만든 부분이다.
 */
export interface GuardConfig {
  /** 진입점 멱등키. 끄면 같은 키의 재제출이 결제 요청을 하나 더 만든다. */
  idempotencyKey: boolean;
  /** 저장소 조건부 전이. 끄면 기대 상태를 보지 않고 덮어써서 두 처리자가 모두 통과한다. */
  claimTransition: boolean;
  /** 승인 조회 대사. 끄면 timeout 을 성공/실패 2 값으로 접는다 - 접는 방향은 아래가 정한다. */
  reconcileQuery: boolean;
  /** 시도 상한. 끄면 실패의 끝이 정의되지 않아 같은 요청을 영원히 다시 보낸다. */
  attemptLimit: boolean;
}

/**
 * 대사를 껐을 때 timeout 을 어느 쪽으로 접는가.
 *
 * 두 값을 다 두는 이유가 이 데모의 논지다 - 2 값으로 접으면 **어느 쪽으로 접어도 틀린다**.
 * 재시도하면 이미 승인된 결제를 다시 청구하고, 포기하면 승인될 수 있었던 결제를 잃는다.
 * 하나만 구현해 두면 "다른 쪽으로 접었으면 됐잖아"라는 반론이 남는다.
 */
export type UnknownFallback = 'retry' | 'abandon';

/**
 * 멈춘 클레임을 어디로 되돌리는가.
 *
 * 'received' 는 그럴듯한 오답이다 - 처리하던 워커가 죽었으니 처음부터 다시 하면 될 것 같지만,
 * 죽은 시점이 PG 전송 전인지 후인지 모르기 때문에 곧바로 이중 승인이 된다.
 */
export type ReclaimTarget = 'unknown' | 'received';

export const ALL_GUARDS_ON: GuardConfig = {
  idempotencyKey: true,
  claimTransition: true,
  reconcileQuery: true,
  attemptLimit: true,
};

export const GUARD_LABEL: Record<keyof GuardConfig, string> = {
  idempotencyKey: '진입점 멱등키',
  claimTransition: '조건부 전이 클레임',
  reconcileQuery: '승인 조회 대사',
  attemptLimit: '시도 상한',
};

/** 껐을 때 무슨 일이 벌어지는지를 코드 옆에 적어 둔다 - 화면 문구가 여기서 나온다. */
export const GUARD_WHEN_OFF: Record<keyof GuardConfig, string> = {
  idempotencyKey: '같은 키의 재제출이 결제 요청을 하나 더 만든다',
  claimTransition: '기대 상태를 보지 않고 덮어써서 두 처리자가 모두 승인 요청을 보낸다',
  reconcileQuery: 'timeout 을 조회 없이 성공/실패 2 값으로 접는다',
  attemptLimit: '실패의 끝이 없어 같은 요청을 계속 다시 보낸다',
};

export const UNKNOWN_FALLBACK_LABEL: Record<UnknownFallback, string> = {
  retry: '실패로 보고 재시도',
  abandon: '실패로 보고 포기',
};

export const RECLAIM_TARGET_LABEL: Record<ReclaimTarget, string> = {
  unknown: '모름으로 회수',
  received: '접수로 되돌림',
};

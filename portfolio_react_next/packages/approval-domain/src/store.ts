import type {
  ApprovalEvent,
  ApprovalEventType,
  ApprovalStatus,
  Clock,
  PaymentRequest,
  TransitionResult,
} from './types';
import { canTransition } from './transitions';
import { ALL_GUARDS_ON, type GuardConfig } from './guards';

export interface ReceiveInput {
  amount: number;
  method: string;
}

/**
 * 인메모리 저장소 모형. 운영 대응은 관계형 DB 한 대다.
 *
 * 이 모형의 원자성은 단일 스레드의 동기 실행이 보장한다. tx()는 "이 블록 안의
 * 읽기-판단-쓰기가 DB 에서는 하나의 트랜잭션"임을 코드에 남기는 경계 표시다.
 * 그래서 tx()는 동기 콜백만 받는다 - await 가 끼는 순간 이 보장이 깨지기 때문이다.
 */
export class MemoryStore {
  private requests = new Map<string, PaymentRequest>();
  private events: ApprovalEvent[] = [];
  private seq = 0;
  // 멱등키 → 요청 ID. 운영에서는 UNIQUE 컬럼이 담당한다.
  private idempotency = new Map<string, string>();
  private lastDelivered: ApprovalEvent[] = [];
  private redeliverRemaining = 0;

  constructor(
    private clock: Clock,
    private guards: GuardConfig = ALL_GUARDS_ON,
  ) {}

  tx<T>(fn: () => T): T {
    return fn();
  }

  /** 접수 트랜잭션: 요청 생성 + PaymentReceived 이벤트 append 가 원자다. */
  receive(
    input: ReceiveInput,
    idempotencyKey?: string,
  ): { created: boolean; request: PaymentRequest } {
    return this.tx(() => {
      // 가드를 끄면 키를 받고도 보지 않는다. 키가 없는 것과 같은 결과가 되어,
      // 더블클릭이 결제 요청 두 건으로 남는다.
      const key = this.guards.idempotencyKey ? idempotencyKey : undefined;
      if (key !== undefined) {
        const existingId = this.idempotency.get(key);
        if (existingId !== undefined) {
          const existing = this.requests.get(existingId);
          if (existing) return { created: false, request: { ...existing } };
        }
      }
      const at = this.clock.now();
      const request: PaymentRequest = {
        id: this.clock.newId(),
        amount: input.amount,
        method: input.method,
        status: 'RECEIVED',
        approveAttempts: 0,
        reconcileFailures: 0,
        createdAt: at,
        updatedAt: at,
      };
      this.requests.set(request.id, request);
      if (key !== undefined) this.idempotency.set(key, request.id);
      this.appendEvent(request.id, 'PaymentReceived', {
        amount: input.amount,
        method: input.method,
      });
      return { created: true, request: { ...request } };
    });
  }

  /**
   * 조건부 상태 전이 - 이중 승인을 막는 저장소의 최종 방어선.
   * DB 대응: UPDATE ... SET status=$to WHERE id=$id AND status=$from
   * (영향 행 수 0 이면 다른 처리자가 선점한 것) + 이벤트 INSERT 를 같은 트랜잭션으로.
   *
   * 기대 상태 불일치는 예외가 아니라 구조화 실패로 돌려준다. "선점당했다"는 경합의
   * 정상 결과라서, 호출자가 오류와 구분해 다뤄야 하기 때문이다. 반면 전이표 자체를
   * 위반하는 호출은 코드 버그이므로 그대로 throw 한다 - 두 실패는 종류가 다르고,
   * 종류를 뭉개면 화면과 로그가 거짓말을 한다.
   */
  transition(
    requestId: string,
    from: ApprovalStatus,
    to: ApprovalStatus,
    eventType: ApprovalEventType,
    detail?: Record<string, unknown>,
    mutate?: (request: PaymentRequest) => void,
  ): TransitionResult {
    if (!canTransition(from, to)) {
      throw new Error(`전이표 위반 (${from} → ${to}) - 호출 코드의 버그다`);
    }
    return this.tx(() => {
      const request = this.requests.get(requestId);
      if (!request) {
        return { ok: false as const, reason: 'NOT_FOUND' as const, requestId, expected: from };
      }
      // 이 한 줄이 저장소의 최종 방어선이다. 끄면 기대 상태를 보지 않고 그대로 덮어쓰므로,
      // 같은 요청을 동시에 집은 두 처리자가 **둘 다** 승인 요청 구간으로 들어간다.
      if (this.guards.claimTransition && request.status !== from) {
        return {
          ok: false as const,
          reason: 'INVALID_TRANSITION' as const,
          requestId,
          expected: from,
          actual: request.status,
        };
      }
      request.status = to;
      if (mutate) mutate(request);
      request.updatedAt = this.clock.now();
      this.appendEvent(requestId, eventType, detail);
      return { ok: true as const, request: { ...request } };
    });
  }

  /** 상태 변화 없이 조회 실패 횟수만 올린다. 이것도 이력에 남긴다 - 이력 전량 보존. */
  recordReconcileFailure(requestId: string): number {
    return this.tx(() => {
      const request = this.requests.get(requestId);
      if (!request) return 0;
      request.reconcileFailures += 1;
      request.updatedAt = this.clock.now();
      this.appendEvent(requestId, 'ApprovalReconciled', {
        outcome: 'query_failed',
        reconcileFailures: request.reconcileFailures,
      });
      return request.reconcileFailures;
    });
  }

  getRequest(requestId: string): PaymentRequest | undefined {
    const request = this.requests.get(requestId);
    return request ? { ...request } : undefined;
  }

  requestsIn(status: ApprovalStatus): PaymentRequest[] {
    return Array.from(this.requests.values())
      .filter((r) => r.status === status)
      .map((r) => ({ ...r }));
  }

  allRequests(): PaymentRequest[] {
    return Array.from(this.requests.values()).map((r) => ({ ...r }));
  }

  getHistory(requestId: string): ApprovalEvent[] {
    return this.events.filter((e) => e.requestId === requestId).map((e) => ({ ...e }));
  }

  allEvents(): ApprovalEvent[] {
    return this.events.map((e) => ({ ...e }));
  }

  /**
   * 중복 전달 스위치. 다음 아웃박스 읽기에서 직전 배치를 한 번 더 얹는다.
   *
   * at-least-once 를 선택한 이상 중복 전달은 사고가 아니라 규약의 일부다.
   * 실제로 이런 일이 벌어지는 경로는 두 가지다 - 소비자가 처리를 마치고 커서를
   * 커밋하기 전에 죽는 경우, 그리고 워커가 두 대 이상 동시에 도는 경우.
   * 앞의 경우는 스위치로, 뒤의 경우는 워커를 실제로 두 개 띄워서 각각 검증한다.
   */
  forceRedeliverNextRead(times = 1): void {
    this.redeliverRemaining = times;
  }

  /**
   * 아웃박스 소비: seq > cursor 인 이벤트를 순서대로 돌려준다.
   * 커서 관리는 소비자 몫이고, 처리 후에 전진시키는 규약이라 전달 보장은 at-least-once 다 -
   * 그래서 소비자는 멱등해야 한다.
   */
  readEventsAfter(cursor: number, types?: readonly ApprovalEventType[]): ApprovalEvent[] {
    const fresh = this.events
      .filter((e) => e.seq > cursor && (types === undefined || types.includes(e.type)))
      .map((e) => ({ ...e }));

    if (this.redeliverRemaining > 0) {
      this.redeliverRemaining -= 1;
      // 새로 읽을 것이 있으면 그 배치를 두 번 전달하고, 없으면 직전 배치를 다시 전달한다.
      // 앞은 브로커가 같은 메시지를 두 번 밀어넣은 경우, 뒤는 소비자가 처리를 마치고
      // 커서를 커밋하기 전에 죽었다가 재기동한 경우다. 둘 다 at-least-once 의 정상 범위다.
      if (fresh.length === 0) return [...this.lastDelivered];
      this.lastDelivered = fresh;
      return [...fresh, ...fresh];
    }
    // 빈 배치는 기억하지 않는다. 재전달로 되살릴 대상은 "마지막으로 실제 전달한 것"이고,
    // 폴링이 몇 바퀴 헛돌았다고 해서 그 사실이 사라지지는 않는다.
    if (fresh.length > 0) this.lastDelivered = fresh;
    return fresh;
  }

  private appendEvent(
    requestId: string,
    type: ApprovalEventType,
    detail?: Record<string, unknown>,
  ): void {
    this.seq += 1;
    this.events.push({ seq: this.seq, requestId, type, at: this.clock.now(), detail });
  }
}

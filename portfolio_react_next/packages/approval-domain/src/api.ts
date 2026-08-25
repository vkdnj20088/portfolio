import type { MemoryStore } from './store';

export interface ApiResponse {
  status: number;
  body: unknown;
}

// 입력 검증은 진입점에서 끝내고, 위반은 구조화 오류로 돌려준다.
// 안쪽 계층(저장소·워커)은 검증된 값만 받는다는 전제로 단순해진다.
function validateBody(
  raw: unknown,
): { ok: true; amount: number; method: string } | { ok: false; field: string; message: string } {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, field: 'body', message: 'JSON 객체가 필요하다' };
  }
  const body = raw as Record<string, unknown>;
  const amount = body['amount'];
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
    return { ok: false, field: 'amount', message: '양의 정수여야 한다' };
  }
  const method = body['method'];
  if (typeof method !== 'string' || method.trim().length === 0) {
    return { ok: false, field: 'method', message: '비어 있지 않은 문자열이어야 한다' };
  }
  return { ok: true, amount, method: method.trim() };
}

/**
 * 진입점 핸들러. HTTP 서버 없이 순수 함수로 둔 이유는 이 엔진이 브라우저에서 그대로 돌기
 * 때문이다 - 응답 형태(상태 코드·본문)는 그대로 두어 경계의 계약은 남기고,
 * 전송 계층만 걷어냈다.
 */
export function createHandlers(store: MemoryStore) {
  return {
    /**
     * 결제 요청 접수. 동기 구간은 이 트랜잭션 커밋까지다 - 201 은 "접수 확정"이고,
     * 승인 진행은 조회의 상태·이력으로 관찰한다.
     */
    receivePayment(rawBody: unknown, idempotencyKey?: string): ApiResponse {
      const parsed = validateBody(rawBody);
      if (!parsed.ok) {
        return {
          status: 400,
          body: {
            error: { code: 'VALIDATION_FAILED', field: parsed.field, message: parsed.message },
          },
        };
      }
      const { created, request } = store.receive(
        { amount: parsed.amount, method: parsed.method },
        idempotencyKey,
      );
      // 같은 멱등키 재제출이면 새 요청을 만들지 않고 동일 요청을 돌려준다(200).
      // 더블클릭·네트워크 재시도가 결제 2건이 되는 것을 막는 1차 방어선.
      return {
        status: created ? 201 : 200,
        body: { requestId: request.id, status: request.status },
      };
    },

    /**
     * 결제 취소. "승인 착수 이전에만 가능"이라는 규칙을 조건부 전이 하나로 강제한다 -
     * `RECEIVED` 에서만 취소가 열리므로, 승인 처리기가 이미 클레임을 쥐었다면 취소가 실패한다.
     * 착수와 취소가 동시에 들어와도 둘 중 하나만 성공하는 이유가 여기에 있다.
     * 별도의 잠금이나 순서 조정 코드가 없는 것은 저장소가 그 일을 대신하기 때문이다.
     */
    cancelPayment(requestId: string): ApiResponse {
      const result = store.transition(requestId, 'RECEIVED', 'CANCELLED', 'PaymentCancelled');
      if (result.ok) {
        return { status: 200, body: { requestId, status: result.request.status } };
      }
      if (result.reason === 'NOT_FOUND') {
        return { status: 404, body: { error: { code: 'REQUEST_NOT_FOUND', requestId } } };
      }
      // 이미 진행된 결제의 취소는 오류가 아니라 "지금은 안 된다"는 사실이다.
      // 현재 상태를 함께 돌려줘서 상담이 왜 안 되는지 화면에서 바로 알 수 있게 한다.
      // 메시지에 "승인 완료라서"라고 단정하지 않는다 - 격리된 요청처럼 승인됐는지조차
      // 확인 못 한 상태도 여기로 오기 때문에, 그렇게 쓰면 화면이 거짓말을 한다.
      return {
        status: 409,
        body: {
          error: {
            code: 'CANCEL_WINDOW_CLOSED',
            requestId,
            currentStatus: result.actual,
            message: `취소는 승인 착수 전에만 가능하다. 현재 상태는 ${result.actual}이며, 이 단계의 취소는 PG 확인이 필요하다`,
          },
        },
      };
    },

    getPayment(requestId: string): ApiResponse {
      const request = store.getRequest(requestId);
      if (!request) {
        return { status: 404, body: { error: { code: 'REQUEST_NOT_FOUND', requestId } } };
      }
      return {
        status: 200,
        body: {
          requestId: request.id,
          status: request.status,
          amount: request.amount,
          method: request.method,
          approveAttempts: request.approveAttempts,
          approvalNo: request.approvalNo ?? null,
          history: store.getHistory(requestId).map((e) => ({
            seq: e.seq,
            type: e.type,
            at: e.at,
            detail: e.detail ?? null,
          })),
        },
      };
    },
  };
}

export type Handlers = ReturnType<typeof createHandlers>;

// 매칭 엔진 도메인 타입 - 순수 TS(프레임워크/React 무관), 전부 decimal 문자열 경계.
// §0: 목업 트레이딩 엔진. 실거래소/실체결/실자산과 무관하다.
import type Decimal from "decimal.js";

export type Side = "buy" | "sell";
export type OrderType = "limit" | "market";

// 주문 생애주기 상태머신. 허용 전이는 canTransition() 이 강제한다.
//   open -> partially_filled -> filled            (체결로 소진)
//   open | partially_filled -> canceled           (취소/시장가 잔량 소멸)
//   (접수 즉시 거절) -> rejected
export type OrderStatus =
  | "open"
  | "partially_filled"
  | "filled"
  | "canceled"
  | "rejected";

// 엔진 입력(경계는 문자열/원시값 - 직렬화/폼 입력과 무손실).
export interface OrderInput {
  id: string;
  ownerId: string; // 자전거래 방지(STP) 판별용
  side: Side;
  type: OrderType;
  price?: string; // limit 필수, market 무시
  qty: string;
  ts: number; // 가격-시간 우선의 "시간"(단조 증가 시퀀스). 엔진은 시계를 읽지 않는다.
}

// 내부/조회용 주문 상태.
export interface Order {
  id: string;
  ownerId: string;
  side: Side;
  type: OrderType;
  price: Decimal | null; // market 은 null
  qty: Decimal; // 최초 수량
  filled: Decimal; // 누적 체결 수량
  status: OrderStatus;
  ts: number;
}

// 체결 한 건 - 항상 메이커(호가에 있던 주문) 가격에 발생한다.
export interface Fill {
  price: string;
  qty: string;
  makerOrderId: string;
  takerOrderId: string;
  takerSide: Side;
  ts: number;
}

// place() 결과: 테이커 최종 상태 + 이번에 발생한 체결들 + 호가에 남았는지.
export interface PlaceResult {
  order: OrderView;
  fills: Fill[];
  resting: boolean;
}

// 외부로 넘기는 불변 뷰(문자열 경계).
export interface OrderView {
  id: string;
  ownerId: string;
  side: Side;
  type: OrderType;
  price: string | null;
  qty: string;
  filled: string;
  remaining: string;
  status: OrderStatus;
  ts: number;
}

// 자전거래 방지 정책. off=허용, cancel-taker=테이커 잔량 취소하고 매칭 중단.
export type StpPolicy = "off" | "cancel-taker";

const ALLOWED: Record<OrderStatus, OrderStatus[]> = {
  open: ["partially_filled", "filled", "canceled"],
  partially_filled: ["partially_filled", "filled", "canceled"],
  filled: [],
  canceled: [],
  rejected: [],
};

// 상태 전이 가드 - 불변식을 코드로 강제(예: filled 는 종단).
export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  if (from === to && (from === "partially_filled")) return true; // 부분체결 누적
  return ALLOWED[from]?.includes(to) ?? false;
}

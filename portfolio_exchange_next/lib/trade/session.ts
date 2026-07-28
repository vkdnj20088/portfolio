// 거래 세션 - 매칭 엔진 위에 얹은 "잔고/포지션/내 주문/내 체결" 순수 상태 계층.
// 순수 함수(부수효과 없음)라 zustand 스토어와 무관하게 단위 테스트로 못박을 수 있다.
// 회계는 예약(reservation) 방식: 지정가 미체결분은 매수=현금/매도=코인을 미리 잡아 두고,
// 나중 체결이나 취소 때 정산한다(이중 지출 방지). §0 목업 - 실자산/실거래와 무관.
import Decimal from "decimal.js";
import { MatchingEngine, seedFromLevels } from "../engine/matchingEngine";
import type { OrderStatus, OrderType, Side } from "../engine/types";

export interface BookLevels {
  asks: { price: number; size: number }[];
  bids: { price: number; size: number }[];
}

export interface Balance {
  krw: string;
  positions: Record<string, string>; // market -> 보유 수량
}

export interface SessionOrder {
  id: string;
  market: string;
  side: Side;
  type: OrderType;
  price: string | null;
  qty: string;
  filled: string;
  remaining: string;
  status: OrderStatus;
  ts: number;
}

export interface SessionFill {
  orderId: string;
  market: string;
  side: Side;
  price: string;
  qty: string;
  ts: number;
}

export interface TradeSession {
  balance: Balance;
  orders: SessionOrder[]; // 미체결(open/partially_filled)만 유지
  fills: SessionFill[]; // 최근 체결(신규가 앞)
}

export interface SubmitReq {
  id: string;
  market: string;
  side: Side;
  type: OrderType;
  price?: string;
  qty: string;
  ts: number;
}

export interface SubmitResult {
  ok: boolean;
  reason?: string;
  status: OrderStatus;
  filledQty: string;
  avgPrice: string | null;
}

export const START_KRW = "10000000"; // 데모 초기 주문가능 금액(1,000만 KRW)
const ZERO = new Decimal(0);
const MAX_FILLS = 50; // 체결 내역 표시 상한

export function initialSession(krw: string = START_KRW): TradeSession {
  return { balance: { krw, positions: {} }, orders: [], fills: [] };
}

export function positionOf(s: TradeSession, market: string): string {
  return posBal(s.balance, market);
}

function posBal(bal: Balance, market: string): string {
  return bal.positions[market] ?? "0";
}

// 주문 접수 + 즉시 매칭 + 회계 반영. 상태 불변식: 잔고 초과/보유 초과면 아무것도 바꾸지 않고 거절.
export function submit(s: TradeSession, req: SubmitReq, book: BookLevels): {
  session: TradeSession;
  result: SubmitResult;
} {
  const qty = new Decimal(req.qty || 0);
  if (!qty.isFinite() || qty.lte(0)) return rejected(s, "수량을 확인해 주세요.");
  let limit: Decimal | null = null;
  if (req.type === "limit") {
    if (req.price == null || req.price === "") return rejected(s, "지정가에는 가격이 필요합니다.");
    limit = new Decimal(req.price);
    if (!limit.isFinite() || limit.lte(0)) return rejected(s, "가격을 확인해 주세요.");
  }

  // 현재 목업 호가를 유동성으로 삼아 엔진에 시딩하고 내 주문을 매칭한다.
  const engine = new MatchingEngine();
  seedFromLevels(engine, book);
  const res = engine.place({
    id: req.id, ownerId: "me", side: req.side, type: req.type,
    price: req.price, qty: req.qty, ts: req.ts,
  });

  const filledQty = res.fills.reduce((a, f) => a.plus(f.qty), ZERO);
  const filledCost = res.fills.reduce((a, f) => a.plus(new Decimal(f.price).mul(f.qty)), ZERO);
  const restingQty = res.resting ? new Decimal(res.order.remaining) : ZERO;

  const krw = new Decimal(s.balance.krw);
  const pos = new Decimal(positionOf(s, req.market));
  let newKrw: Decimal;
  let newPos: Decimal;

  if (req.side === "buy") {
    // 체결분 현금 + 미체결분(지정가) 예약 현금이 주문가능 금액을 넘으면 거절.
    const reserve = limit ? restingQty.mul(limit) : ZERO;
    const need = filledCost.plus(reserve);
    if (need.gt(krw)) return rejected(s, "주문가능 금액을 초과했습니다.");
    newKrw = krw.minus(need);
    newPos = pos.plus(filledQty);
  } else {
    // 매도: 체결분 + 미체결 예약분 코인이 보유를 넘으면 거절.
    const reserveQty = filledQty.plus(restingQty);
    if (reserveQty.gt(pos)) return rejected(s, "보유 수량을 초과했습니다.");
    newPos = pos.minus(reserveQty);
    newKrw = krw.plus(filledCost);
  }

  const fills = pushFills(s.fills, res.fills.map((f) => ({
    orderId: req.id, market: req.market, side: req.side, price: f.price, qty: f.qty, ts: f.ts,
  })));
  const orders = res.resting
    ? [restingOrder(req, res.order.remaining, filledQty), ...s.orders]
    : s.orders;

  return {
    session: { balance: setBalance(s.balance, req.market, newKrw, newPos), orders, fills },
    result: {
      ok: true, status: res.order.status,
      filledQty: filledQty.toString(),
      avgPrice: filledQty.gt(ZERO) ? filledCost.div(filledQty).toDecimalPlaces(0).toString() : null,
    },
  };
}

// 시세가 미체결 지정가를 가로지르면 체결시킨다(open -> filled). 예약분은 이미 잡혀 있으므로
// 반대 자산만 지급한다. 반환: 새 세션 + 이번에 체결된 주문 id 들.
export function evaluateResting(s: TradeSession, market: string, price: string, ts: number): {
  session: TradeSession;
  filledIds: string[];
} {
  const p = new Decimal(price);
  const filledIds: string[] = [];
  let balance = s.balance;
  const newFills: SessionFill[] = [];
  const remaining: SessionOrder[] = [];

  for (const o of s.orders) {
    const crosses = o.market === market && o.price != null && (
      o.side === "buy" ? p.lte(o.price) : p.gte(o.price)
    );
    if (!crosses) { remaining.push(o); continue; }
    const limit = new Decimal(o.price!);
    const rem = new Decimal(o.remaining);
    if (o.side === "buy") {
      // 현금은 예약됨 -> 코인만 지급.
      balance = setBalance(balance, market, new Decimal(balance.krw), new Decimal(posBal(balance, market)).plus(rem));
    } else {
      // 코인은 예약됨 -> 현금만 지급(지정가 기준).
      balance = setBalance(balance, market, new Decimal(balance.krw).plus(rem.mul(limit)), new Decimal(posBal(balance, market)));
    }
    newFills.push({ orderId: o.id, market, side: o.side, price: o.price!, qty: o.remaining, ts });
    filledIds.push(o.id);
  }

  if (filledIds.length === 0) return { session: s, filledIds };
  return { session: { balance, orders: remaining, fills: pushFills(s.fills, newFills) }, filledIds };
}

// 미체결 주문 취소 - 예약분을 환급하고 목록에서 제거.
export function cancel(s: TradeSession, orderId: string): TradeSession {
  const o = s.orders.find((x) => x.id === orderId);
  if (!o || o.price == null) return s;
  const rem = new Decimal(o.remaining);
  const limit = new Decimal(o.price);
  let balance = s.balance;
  if (o.side === "buy") {
    balance = setBalance(balance, o.market,
      new Decimal(balance.krw).plus(rem.mul(limit)), new Decimal(positionOf(s, o.market)));
  } else {
    balance = setBalance(balance, o.market,
      new Decimal(balance.krw), new Decimal(positionOf(s, o.market)).plus(rem));
  }
  return { balance, orders: s.orders.filter((x) => x.id !== orderId), fills: s.fills };
}

// ── 내부 헬퍼 ──────────────────────────────────────────────────────────────

function rejected(s: TradeSession, reason: string): { session: TradeSession; result: SubmitResult } {
  return { session: s, result: { ok: false, reason, status: "rejected", filledQty: "0", avgPrice: null } };
}

function restingOrder(req: SubmitReq, remaining: string, filledQty: Decimal): SessionOrder {
  return {
    id: req.id, market: req.market, side: req.side, type: req.type,
    price: req.price ?? null, qty: req.qty, filled: filledQty.toString(), remaining,
    status: filledQty.gt(ZERO) ? "partially_filled" : "open", ts: req.ts,
  };
}

function pushFills(prev: SessionFill[], add: SessionFill[]): SessionFill[] {
  return [...add.slice().reverse(), ...prev].slice(0, MAX_FILLS);
}

function setBalance(bal: Balance, market: string, krw: Decimal, pos: Decimal): Balance {
  const positions = { ...bal.positions };
  if (pos.lte(ZERO)) delete positions[market];
  else positions[market] = pos.toString();
  return { krw: krw.toString(), positions };
}

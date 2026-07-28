// 가격-시간 우선(price-time priority) 한계 오더북 매칭 엔진.
// 순수 결정적: 시계/난수를 읽지 않고, 호출자가 넘긴 id/ts 로만 동작한다 -> 테스트 재현 가능.
// 체결가는 항상 "메이커(호가에 먼저 있던 주문) 가격". decimal.js 로 부동소수 오차를 배제한다.
import Decimal from "decimal.js";
import {
  canTransition,
  type Fill,
  type Order,
  type OrderInput,
  type OrderView,
  type PlaceResult,
  type StpPolicy,
} from "./types";

const ZERO = new Decimal(0);

function toView(o: Order): OrderView {
  return {
    id: o.id,
    ownerId: o.ownerId,
    side: o.side,
    type: o.type,
    price: o.price ? o.price.toString() : null,
    qty: o.qty.toString(),
    filled: o.filled.toString(),
    remaining: o.qty.minus(o.filled).toString(),
    status: o.status,
    ts: o.ts,
  };
}

export interface EngineOptions {
  stp?: StpPolicy; // 자전거래 방지(기본 off)
}

export class MatchingEngine {
  // 매도 호가: 가격 오름차순, 동일가는 ts 오름차순(먼저 온 것 우선).
  private asks: Order[] = [];
  // 매수 호가: 가격 내림차순, 동일가는 ts 오름차순.
  private bids: Order[] = [];
  private readonly stp: StpPolicy;

  constructor(opts: EngineOptions = {}) {
    this.stp = opts.stp ?? "off";
  }

  // 주문 접수 및 매칭. 반환: 테이커 최종 상태 + 이번 체결 + 호가 잔류 여부.
  place(input: OrderInput): PlaceResult {
    const qty = new Decimal(input.qty);
    // 접수 검증 - 위반은 즉시 rejected(엔진 상태 불변).
    if (!qty.isFinite() || qty.lte(0)) return this.reject(input);
    let price: Decimal | null = null;
    if (input.type === "limit") {
      if (input.price == null) return this.reject(input);
      price = new Decimal(input.price);
      if (!price.isFinite() || price.lte(0)) return this.reject(input);
    }

    const taker: Order = {
      id: input.id,
      ownerId: input.ownerId,
      side: input.side,
      type: input.type,
      price,
      qty,
      filled: ZERO,
      status: "open",
      ts: input.ts,
    };

    const fills: Fill[] = [];
    const book = taker.side === "buy" ? this.asks : this.bids;

    // 상대 호가를 우선순위(정렬)대로 소진.
    while (book.length > 0 && taker.filled.lt(taker.qty)) {
      const maker = book[0];
      if (!this.crosses(taker, maker)) break; // 지정가 한계 밖이면 매칭 종료
      if (this.stp === "cancel-taker" && maker.ownerId === taker.ownerId) {
        // 자전거래 방지: 테이커 잔량 취소하고 매칭 중단(메이커는 보존).
        this.transition(taker, "canceled");
        return { order: toView(taker), fills, resting: false };
      }
      const makerRemaining = maker.qty.minus(maker.filled);
      const takerRemaining = taker.qty.minus(taker.filled);
      const traded = Decimal.min(makerRemaining, takerRemaining);

      maker.filled = maker.filled.plus(traded);
      taker.filled = taker.filled.plus(traded);
      fills.push({
        price: maker.price!.toString(), // 메이커는 항상 지정가
        qty: traded.toString(),
        makerOrderId: maker.id,
        takerOrderId: taker.id,
        takerSide: taker.side,
        ts: input.ts,
      });

      if (maker.filled.gte(maker.qty)) {
        this.transition(maker, "filled");
        book.shift(); // 완전체결 메이커 제거
      } else {
        this.transition(maker, "partially_filled");
      }
    }

    // 테이커 종결 처리.
    if (taker.filled.gte(taker.qty)) {
      this.transition(taker, "filled");
      return { order: toView(taker), fills, resting: false };
    }
    // 잔량 존재: 지정가면 호가에 올리고, 시장가면 유동성 부족분을 취소.
    if (taker.type === "limit") {
      if (taker.filled.gt(ZERO)) this.transition(taker, "partially_filled");
      this.rest(taker);
      return { order: toView(taker), fills, resting: true };
    }
    // 시장가 잔량 -> 취소(부분체결 후 잔량 소멸).
    if (taker.filled.gt(ZERO)) this.transition(taker, "partially_filled");
    this.transition(taker, "canceled");
    return { order: toView(taker), fills, resting: false };
  }

  // 호가에서 미체결 주문 취소. 성공 시 취소된 뷰, 없으면 null.
  cancel(orderId: string): OrderView | null {
    for (const book of [this.asks, this.bids]) {
      const i = book.findIndex((o) => o.id === orderId);
      if (i >= 0) {
        const [o] = book.splice(i, 1);
        this.transition(o, "canceled");
        return toView(o);
      }
    }
    return null;
  }

  // 현재 호가 집계 스냅샷(가격대별 합계 수량) - UI/검증용.
  snapshot(): { asks: { price: string; qty: string }[]; bids: { price: string; qty: string }[] } {
    return { asks: aggregate(this.asks), bids: aggregate(this.bids) };
  }

  // 최우선 매수/매도 호가(스프레드 계산용).
  bestBid(): string | null {
    return this.bids.length ? this.bids[0].price!.toString() : null;
  }
  bestAsk(): string | null {
    return this.asks.length ? this.asks[0].price!.toString() : null;
  }

  // 지정가 주문이 상대 호가와 교차하는가.
  private crosses(taker: Order, maker: Order): boolean {
    if (taker.type === "market") return true; // 시장가는 가격 한계 없음
    if (taker.side === "buy") return taker.price!.gte(maker.price!);
    return taker.price!.lte(maker.price!);
  }

  // 정렬 규칙을 유지하며 호가에 삽입(가격 우선, 동일가는 ts 우선).
  private rest(o: Order) {
    if (o.side === "buy") {
      const i = this.bids.findIndex(
        (b) => o.price!.gt(b.price!) || (o.price!.eq(b.price!) && o.ts < b.ts),
      );
      if (i < 0) this.bids.push(o);
      else this.bids.splice(i, 0, o);
    } else {
      const i = this.asks.findIndex(
        (a) => o.price!.lt(a.price!) || (o.price!.eq(a.price!) && o.ts < a.ts),
      );
      if (i < 0) this.asks.push(o);
      else this.asks.splice(i, 0, o);
    }
  }

  private transition(o: Order, to: Order["status"]) {
    if (!canTransition(o.status, to)) {
      throw new Error(`잘못된 주문 상태 전이: ${o.status} -> ${to} (${o.id})`);
    }
    o.status = to;
  }

  private reject(input: OrderInput): PlaceResult {
    return {
      order: {
        id: input.id,
        ownerId: input.ownerId,
        side: input.side,
        type: input.type,
        price: input.price ?? null,
        qty: input.qty,
        filled: "0",
        remaining: input.qty,
        status: "rejected",
        ts: input.ts,
      },
      fills: [],
      resting: false,
    };
  }
}

function aggregate(book: Order[]): { price: string; qty: string }[] {
  const by = new Map<string, Decimal>();
  for (const o of book) {
    const p = o.price!.toString();
    by.set(p, (by.get(p) ?? ZERO).plus(o.qty.minus(o.filled)));
  }
  return [...by.entries()].map(([price, qty]) => ({ price, qty: qty.toString() }));
}

// 호가 레벨 목록으로 엔진을 시딩(목업 호가창 -> 실주문 매칭 대상). id/owner 는 합성.
export function seedFromLevels(
  engine: MatchingEngine,
  levels: { asks: { price: number; size: number }[]; bids: { price: number; size: number }[] },
  ownerId = "book",
  startTs = 0,
): void {
  let ts = startTs;
  for (const a of levels.asks) {
    engine.place({ id: `seed-a-${a.price}`, ownerId, side: "sell", type: "limit", price: String(a.price), qty: String(a.size), ts: ts++ });
  }
  for (const b of levels.bids) {
    engine.place({ id: `seed-b-${b.price}`, ownerId, side: "buy", type: "limit", price: String(b.price), qty: String(b.size), ts: ts++ });
  }
}

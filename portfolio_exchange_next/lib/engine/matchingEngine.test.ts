import { describe, expect, it } from "vitest";
import { MatchingEngine, seedFromLevels } from "./matchingEngine";
import type { OrderInput } from "./types";

// 테스트 헬퍼 - id/ts 를 순번으로 자동 부여(가격-시간 우선의 "시간"은 단조 시퀀스).
function mk(over: Partial<OrderInput> & Pick<OrderInput, "side" | "qty">, ts: number): OrderInput {
  return {
    id: over.id ?? `o${ts}`,
    ownerId: over.ownerId ?? "u1",
    side: over.side,
    type: over.type ?? "limit",
    price: over.price,
    qty: over.qty,
    ts,
  };
}

describe("MatchingEngine - 지정가 매칭", () => {
  it("교차하지 않으면 호가에 남고 체결이 없다", () => {
    const e = new MatchingEngine();
    const r = e.place(mk({ side: "buy", price: "100", qty: "1" }, 1));
    expect(r.fills).toHaveLength(0);
    expect(r.resting).toBe(true);
    expect(r.order.status).toBe("open");
    expect(e.bestBid()).toBe("100");
  });

  it("교차하는 매수는 메이커 가격에 전량 체결된다", () => {
    const e = new MatchingEngine();
    e.place(mk({ side: "sell", price: "100", qty: "2" }, 1)); // 메이커 매도
    const r = e.place(mk({ side: "buy", price: "101", qty: "2" }, 2)); // 테이커 매수(101 지정)
    expect(r.fills).toHaveLength(1);
    expect(r.fills[0].price).toBe("100"); // 체결가 = 메이커 100, 테이커 지정 101 아님
    expect(r.fills[0].qty).toBe("2");
    expect(r.order.status).toBe("filled");
    expect(r.resting).toBe(false);
    expect(e.bestAsk()).toBeNull(); // 메이커 소진
  });

  it("부분체결: 큰 테이커는 남은 수량을 호가에 올린다", () => {
    const e = new MatchingEngine();
    e.place(mk({ side: "sell", price: "100", qty: "1" }, 1));
    const r = e.place(mk({ side: "buy", price: "100", qty: "3" }, 2));
    expect(r.fills).toHaveLength(1);
    expect(r.fills[0].qty).toBe("1");
    expect(r.order.status).toBe("partially_filled");
    expect(r.order.remaining).toBe("2");
    expect(r.resting).toBe(true);
    expect(e.bestBid()).toBe("100"); // 잔량 2가 매수호가로
  });
});

describe("MatchingEngine - 가격-시간 우선순위", () => {
  it("더 좋은 가격이 먼저 체결된다", () => {
    const e = new MatchingEngine();
    e.place(mk({ id: "a99", side: "sell", price: "99", qty: "1" }, 1));
    e.place(mk({ id: "a100", side: "sell", price: "100", qty: "1" }, 2));
    const r = e.place(mk({ side: "buy", price: "100", qty: "1" }, 3));
    expect(r.fills[0].makerOrderId).toBe("a99"); // 99가 100보다 우선
  });

  it("동일 가격이면 먼저 온 주문이 우선(FIFO)", () => {
    const e = new MatchingEngine();
    e.place(mk({ id: "first", side: "sell", price: "100", qty: "1" }, 1));
    e.place(mk({ id: "second", side: "sell", price: "100", qty: "1" }, 2));
    const r = e.place(mk({ side: "buy", price: "100", qty: "1" }, 3));
    expect(r.fills[0].makerOrderId).toBe("first");
  });
});

describe("MatchingEngine - 시장가", () => {
  it("여러 레벨을 쓸어담아 체결한다", () => {
    const e = new MatchingEngine();
    e.place(mk({ side: "sell", price: "100", qty: "1" }, 1));
    e.place(mk({ side: "sell", price: "101", qty: "1" }, 2));
    const r = e.place(mk({ side: "buy", type: "market", qty: "2" }, 3));
    expect(r.fills).toHaveLength(2);
    expect(r.fills.map((f) => f.price)).toEqual(["100", "101"]);
    expect(r.order.status).toBe("filled");
  });

  it("유동성 부족 시 부분체결 후 잔량은 취소된다", () => {
    const e = new MatchingEngine();
    e.place(mk({ side: "sell", price: "100", qty: "1" }, 1));
    const r = e.place(mk({ side: "buy", type: "market", qty: "5" }, 2));
    expect(r.fills).toHaveLength(1);
    expect(r.order.status).toBe("canceled");
    expect(r.order.filled).toBe("1");
    expect(r.resting).toBe(false); // 시장가 잔량은 호가에 남기지 않는다
  });
});

describe("MatchingEngine - decimal 정밀", () => {
  it("0.1 + 0.2 누적이 정확히 0.3 (부동소수 오차 없음)", () => {
    const e = new MatchingEngine();
    e.place(mk({ side: "sell", price: "100", qty: "0.1" }, 1));
    e.place(mk({ side: "sell", price: "100", qty: "0.2" }, 2));
    const r = e.place(mk({ side: "buy", price: "100", qty: "0.3" }, 3));
    const total = r.fills.reduce((s, f) => s + Number(f.qty), 0);
    // 문자열 합산이 아니라 정확 체결을 확인: 테이커가 정확히 소진되어 호가에 안 남음
    expect(r.order.status).toBe("filled");
    expect(r.order.remaining).toBe("0");
    expect(total).toBeCloseTo(0.3, 10);
  });
});

describe("MatchingEngine - 취소/거절", () => {
  it("미체결 주문을 취소하면 호가에서 사라진다", () => {
    const e = new MatchingEngine();
    e.place(mk({ id: "x", side: "buy", price: "100", qty: "1" }, 1));
    const c = e.cancel("x");
    expect(c?.status).toBe("canceled");
    expect(e.bestBid()).toBeNull();
    expect(e.cancel("x")).toBeNull(); // 두 번째 취소는 없음
  });

  it("수량 0/음수/비유한은 거절(엔진 상태 불변)", () => {
    const e = new MatchingEngine();
    expect(e.place(mk({ side: "buy", price: "100", qty: "0" }, 1)).order.status).toBe("rejected");
    expect(e.place(mk({ side: "buy", price: "100", qty: "-1" }, 2)).order.status).toBe("rejected");
    expect(e.place(mk({ side: "buy", type: "limit", qty: "1" }, 3)).order.status).toBe("rejected"); // 지정가 가격 누락
    expect(e.bestBid()).toBeNull();
  });
});

describe("MatchingEngine - 자전거래 방지(STP)", () => {
  it("cancel-taker: 같은 소유자 호가와는 체결하지 않고 테이커를 취소한다", () => {
    const e = new MatchingEngine({ stp: "cancel-taker" });
    e.place(mk({ ownerId: "same", side: "sell", price: "100", qty: "1" }, 1));
    const r = e.place(mk({ ownerId: "same", side: "buy", price: "100", qty: "1" }, 2));
    expect(r.fills).toHaveLength(0);
    expect(r.order.status).toBe("canceled");
    expect(e.bestAsk()).toBe("100"); // 메이커는 보존
  });

  it("off(기본): 같은 소유자여도 체결한다", () => {
    const e = new MatchingEngine();
    e.place(mk({ ownerId: "same", side: "sell", price: "100", qty: "1" }, 1));
    const r = e.place(mk({ ownerId: "same", side: "buy", price: "100", qty: "1" }, 2));
    expect(r.fills).toHaveLength(1);
  });
});

describe("seedFromLevels - 목업 호가창 시딩", () => {
  it("레벨 목록으로 엔진을 채우고 실주문이 그 유동성과 체결된다", () => {
    const e = new MatchingEngine();
    seedFromLevels(e, {
      asks: [{ price: 100, size: 1 }, { price: 101, size: 1 }],
      bids: [{ price: 99, size: 1 }, { price: 98, size: 1 }],
    });
    expect(e.bestAsk()).toBe("100");
    expect(e.bestBid()).toBe("99");
    const r = e.place({ id: "t", ownerId: "u", side: "buy", type: "market", qty: "1.5", ts: 100 });
    expect(r.order.filled).toBe("1.5");
    expect(e.bestAsk()).toBe("101"); // 100 소진, 101 부분
  });
});

import { describe, expect, it } from "vitest";
import {
  cancel,
  evaluateResting,
  initialSession,
  positionOf,
  submit,
  START_KRW,
  type BookLevels,
  type SubmitReq,
} from "./session";

const BOOK: BookLevels = {
  asks: [{ price: 100, size: 1 }, { price: 101, size: 1 }, { price: 102, size: 1 }],
  bids: [{ price: 99, size: 1 }, { price: 98, size: 1 }],
};

function req(over: Partial<SubmitReq> & Pick<SubmitReq, "side" | "qty">, ts = 1): SubmitReq {
  return {
    id: over.id ?? `o${ts}`, market: over.market ?? "BTC",
    side: over.side, type: over.type ?? "market", price: over.price, qty: over.qty, ts,
  };
}

describe("submit - 시장가 체결과 잔고", () => {
  it("시장가 매수: 여러 레벨 체결, 현금 차감, 코인 증가", () => {
    const { session, result } = submit(initialSession(), req({ side: "buy", qty: "1.5" }), BOOK);
    expect(result.ok).toBe(true);
    expect(result.status).toBe("filled");
    expect(result.filledQty).toBe("1.5"); // 100(1) + 101(0.5)
    // 비용 100*1 + 101*0.5 = 150.5 -> 현금 차감
    expect(session.balance.krw).toBe(String(Number(START_KRW) - 150.5));
    expect(positionOf(session, "BTC")).toBe("1.5");
    expect(session.fills.length).toBe(2);
  });

  it("시장가 매수 잔고 부족: 거절, 상태 불변", () => {
    const poor = initialSession("50"); // 100짜리 한 개도 못 삼
    const { session, result } = submit(poor, req({ side: "buy", qty: "1" }), BOOK);
    expect(result.ok).toBe(false);
    expect(result.status).toBe("rejected");
    expect(session).toBe(poor); // 원본 그대로(불변)
  });

  it("시장가 매도: 보유가 있어야 하고, 없으면 거절", () => {
    const empty = initialSession();
    expect(submit(empty, req({ side: "sell", qty: "1" }), BOOK).result.ok).toBe(false);
  });

  it("매수 후 매도로 포지션이 줄고 현금이 는다", () => {
    let s = submit(initialSession(), req({ side: "buy", qty: "1" }), BOOK).session; // 100 지출, +1 코인
    expect(positionOf(s, "BTC")).toBe("1");
    const sold = submit(s, req({ side: "sell", qty: "1" }, 2), BOOK); // 최우선 매수호가 99에 체결
    s = sold.session;
    expect(sold.result.filledQty).toBe("1");
    expect(positionOf(s, "BTC")).toBe("0");
    // 현금: 1000만 - 100(매수) + 99(매도)
    expect(s.balance.krw).toBe(String(Number(START_KRW) - 100 + 99));
  });
});

describe("submit - 지정가 미체결과 예약", () => {
  it("교차하지 않는 지정가 매수는 미체결로 남고 현금이 예약된다", () => {
    const { session, result } = submit(
      initialSession(), req({ side: "buy", type: "limit", price: "97", qty: "2" }), BOOK);
    expect(result.status).toBe("open");
    expect(result.filledQty).toBe("0");
    expect(session.orders).toHaveLength(1);
    expect(session.orders[0].status).toBe("open");
    // 예약: 97 * 2 = 194 만큼 현금 감소
    expect(session.balance.krw).toBe(String(Number(START_KRW) - 194));
  });

  it("지정가 매수가 교차하면 즉시 체결 + 잔량은 미체결로 예약", () => {
    // 100.5 매수: 100(1) 체결, 잔량 1은 100.5 지정가로 미체결
    const { session, result } = submit(
      initialSession(), req({ side: "buy", type: "limit", price: "100.5", qty: "2" }), BOOK);
    expect(result.filledQty).toBe("1");
    expect(session.orders).toHaveLength(1);
    expect(session.orders[0].status).toBe("partially_filled");
    expect(positionOf(session, "BTC")).toBe("1");
  });
});

describe("evaluateResting - 시세가 미체결 지정가를 체결", () => {
  it("시세가 지정가 이하로 내려오면 미체결 매수가 체결된다", () => {
    const placed = submit(
      initialSession(), req({ side: "buy", type: "limit", price: "97", qty: "2" }), BOOK).session;
    const krwAfterReserve = placed.balance.krw;
    const { session, filledIds } = evaluateResting(placed, "BTC", "97", 10);
    expect(filledIds).toHaveLength(1);
    expect(session.orders).toHaveLength(0); // 체결되어 미체결 목록에서 빠짐
    expect(positionOf(session, "BTC")).toBe("2"); // 코인 지급
    expect(session.balance.krw).toBe(krwAfterReserve); // 현금은 예약 때 이미 빠짐 -> 변화 없음
    expect(session.fills[0].qty).toBe("2");
  });

  it("시세가 지정가를 건드리지 않으면 그대로 미체결", () => {
    const placed = submit(
      initialSession(), req({ side: "buy", type: "limit", price: "97", qty: "1" }), BOOK).session;
    const { session, filledIds } = evaluateResting(placed, "BTC", "99", 10);
    expect(filledIds).toHaveLength(0);
    expect(session.orders).toHaveLength(1);
  });
});

describe("cancel - 예약 환급", () => {
  it("미체결 매수 취소 시 예약 현금이 환급된다", () => {
    const placed = submit(
      initialSession(), req({ side: "buy", type: "limit", price: "97", qty: "2" }), BOOK).session;
    const s = cancel(placed, placed.orders[0].id);
    expect(s.orders).toHaveLength(0);
    expect(s.balance.krw).toBe(START_KRW); // 194 환급 -> 원복
  });

  it("존재하지 않는 주문 취소는 무시", () => {
    const s0 = initialSession();
    expect(cancel(s0, "nope")).toBe(s0);
  });
});

// ── 스탑 지정가 주문(#E1) ────────────────────────────────────────────────
// 여기서 고정하는 것은 "트리거 전에는 호가에 없다"와 "예약은 접수 시점에 잡는다"다.
// 두 성질 중 하나만 깨져도 이중 지출이나 유령 체결이 생긴다.
describe("스탑 지정가 - 트리거 상태를 가진 주문 생애주기", () => {
  const book: BookLevels = { asks: [{ price: 100, size: 5 }], bids: [{ price: 99, size: 5 }] };

  function placeStop(side: "buy" | "sell", trigger: string, limit: string, qty: string, s = initialSession("1000000")) {
    return submit(s, { id: "s1", market: "BTC", side, type: "stopLimit", price: limit, triggerPrice: trigger, qty, ts: 1 }, book);
  }

  it("트리거 가격이 없으면 거절한다", () => {
    const { result } = submit(initialSession(), { id: "x", market: "BTC", side: "buy", type: "stopLimit", price: "100", qty: "1", ts: 1 }, book);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("트리거");
  });

  it("접수 시점에 예약을 잡는다 - 잡지 않으면 같은 잔고로 여러 스탑을 걸 수 있다", () => {
    const { session, result } = placeStop("buy", "110", "111", "2");
    expect(result.ok).toBe(true);
    expect(result.status).toBe("open");
    // 2 × 111 = 222 가 예약됐다.
    expect(session.balance.krw).toBe("999778");
    expect(session.orders).toHaveLength(1);
    expect(session.orders[0].triggered).toBe(false);
    expect(session.orders[0].type).toBe("stopLimit");
  });

  it("예약이 잔고를 넘으면 거절하고 아무것도 바꾸지 않는다", () => {
    const s0 = initialSession("100");
    const { session, result } = placeStop("buy", "110", "111", "2", s0);
    expect(result.ok).toBe(false);
    expect(session).toBe(s0); // 동일 참조 = 무변경
  });

  it("트리거 전 시세로는 체결되지 않는다 - 호가에 없는 주문이다", () => {
    const { session } = placeStop("buy", "110", "111", "1");
    // 111 은 지정가 매수 조건(p <= 111)을 만족하지만 트리거(110)는 아직 안 닿았다.
    const { session: after, filledIds, triggeredIds } = evaluateResting(session, "BTC", "105", 10);
    expect(filledIds).toEqual([]);
    expect(triggeredIds).toEqual([]);
    expect(after).toBe(session);
  });

  it("매수 스탑은 상승 돌파에서 트리거된다", () => {
    const { session } = placeStop("buy", "110", "120", "1");
    const { session: after, triggeredIds, filledIds } = evaluateResting(session, "BTC", "110", 10);
    expect(triggeredIds).toEqual(["s1"]);
    // 트리거와 동시에 지정가(120) 조건(p <= 120)도 만족 -> 같은 틱에 체결된다(갭 상승 재현).
    expect(filledIds).toEqual(["s1"]);
    expect(after.orders).toHaveLength(0);
    expect(after.balance.positions.BTC).toBe("1");
  });

  it("매도 스탑은 하락 손절에서 트리거된다", () => {
    // 보유를 만들고 나서 매도 스탑을 건다.
    const bought = submit(initialSession("1000000"), { id: "b", market: "BTC", side: "buy", type: "market", qty: "3", ts: 1 }, book);
    const { session } = submit(bought.session, { id: "s1", market: "BTC", side: "sell", type: "stopLimit", price: "90", triggerPrice: "95", qty: "2", ts: 2 }, book);
    expect(session.orders[0].triggered).toBe(false);

    // 96 은 트리거(95) 위 -> 아무 일 없음.
    expect(evaluateResting(session, "BTC", "96", 10).triggeredIds).toEqual([]);
    // 95 도달 -> 트리거. 지정가 90 조건(p >= 90)도 만족해 같은 틱에 체결.
    const hit = evaluateResting(session, "BTC", "95", 11);
    expect(hit.triggeredIds).toEqual(["s1"]);
    expect(hit.filledIds).toEqual(["s1"]);
  });

  it("트리거됐지만 지정가에 못 미치면 미체결 지정가로 남는다", () => {
    const { session } = placeStop("buy", "110", "105", "1");
    // 110 도달 -> 트리거. 그러나 지정가 105 는 p(110) <= 105 가 아니라 체결되지 않는다.
    const after = evaluateResting(session, "BTC", "110", 10);
    expect(after.triggeredIds).toEqual(["s1"]);
    expect(after.filledIds).toEqual([]);
    expect(after.session.orders).toHaveLength(1);
    expect(after.session.orders[0].type).toBe("limit"); // 전환 완료
    expect(after.session.orders[0].triggered).toBe(true);
    // 이후 105 로 내려오면 체결된다.
    expect(evaluateResting(after.session, "BTC", "105", 11).filledIds).toEqual(["s1"]);
  });

  it("트리거 전에 취소하면 예약이 환급된다", () => {
    const { session } = placeStop("buy", "110", "111", "2");
    expect(session.balance.krw).toBe("999778");
    const canceled = cancel(session, "s1");
    expect(canceled.balance.krw).toBe("1000000");
    expect(canceled.orders).toHaveLength(0);
  });
});

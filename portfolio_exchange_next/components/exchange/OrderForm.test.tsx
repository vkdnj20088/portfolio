// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { MarketSnapshot } from "@/lib/mock/data";

// 시세 피드는 초기 스냅샷을 그대로 돌려주도록 목(엔진/타이머/BroadcastChannel 배제 - 결정적).
vi.mock("@/store/marketStore", () => ({
  useMarketFeed: (_market: string, initial: MarketSnapshot) => initial,
}));

import OrderForm from "./OrderForm";
import { useTradeStore } from "@/store/tradeStore";

const SNAP: MarketSnapshot = {
  market: "BTC",
  price: 100,
  changeRate: 0,
  volume: 0,
  orderbook: {
    asks: [{ price: 100, size: 5 }, { price: 101, size: 5 }],
    bids: [{ price: 99, size: 5 }, { price: 98, size: 5 }],
  },
  trades: [],
};

describe("OrderForm - 주문 배선(E4)", () => {
  beforeEach(() => {
    useTradeStore.getState().reset(); // 잔고/포지션 초기화(테스트 격리)
  });
  afterEach(cleanup); // 렌더 정리 - 다음 테스트에 DOM 이 누적되지 않게

  it("초기 잔고와 주문 버튼을 렌더한다", () => {
    render(<OrderForm market="BTC" initial={SNAP} />);
    expect(screen.getByText(/주문가능 10,000,000 KRW/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "매수 주문" })).toBeTruthy();
  });

  it("시장가 매수가 엔진으로 체결되어 잔고가 줄고 결과가 뜬다", () => {
    render(<OrderForm market="BTC" initial={SNAP} />);
    fireEvent.click(screen.getByRole("button", { name: "시장가" }));
    fireEvent.change(screen.getByLabelText("주문 수량 (BTC)"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "매수 주문" }));

    // 결과 메시지(체결) + 잔고 100 KRW 차감(1 @ 100)
    expect(screen.getByRole("status").textContent).toMatch(/체결/);
    expect(screen.getByText(/주문가능 9,999,900 KRW/)).toBeTruthy();
    expect(useTradeStore.getState().session.balance.positions.BTC).toBe("1");
  });

  it("수량이 없으면 거절 메시지를 보이고 주문하지 않는다", () => {
    render(<OrderForm market="BTC" initial={SNAP} />);
    fireEvent.click(screen.getByRole("button", { name: "매수 주문" }));
    expect(screen.getByRole("status").textContent).toMatch(/수량/);
    expect(useTradeStore.getState().session.balance.krw).toBe("10000000"); // 불변
  });
});

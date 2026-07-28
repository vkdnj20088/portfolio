"use client";
import { useEffect, useRef } from "react";
import { useMarketFeed } from "@/store/marketStore";
import { useOrderDraftStore } from "@/store/orderDraftStore";
import { formatKRW, formatQty } from "@/lib/format";
import type { Level, MarketSnapshot } from "@/lib/mock/data";
// 누적합(depth bar 폭 계산) - 렌더 밖 순수 함수. 컴포넌트 스코프 변수 재대입을 피해
// React 불변성 규칙을 지키면서 O(n) 누적을 유지한다.
function cumulative(levels: Level[]): { cum: number[]; total: number } {
  const cum: number[] = [];
  let running = 0;
  for (const l of levels) { running += l.size; cum.push(running); }
  return { cum, total: running };
}
export default function OrderBook({ market, initial }: { market: string; initial: MarketSnapshot }) {
  const snap = useMarketFeed(market, initial)!;
  const setPrice = useOrderDraftStore((s) => s.setPrice);
  const scrollRef = useRef<HTMLDivElement>(null);
  const centerRef = useRef<HTMLDivElement>(null);
  useEffect(() => { // 진입 시 현재가 경계를 중앙에 (scrollBiddingToBoundary 계승)
    const c = scrollRef.current, mid = centerRef.current;
    if (c && mid) c.scrollTop = mid.offsetTop - c.clientHeight / 2 + mid.clientHeight / 2;
  }, [market]);
  const { asks, bids } = snap.orderbook;
  const { cum: askCum, total: askMax } = cumulative(asks);
  const { cum: bidCum, total: bidMax } = cumulative(bids);
  const max = Math.max(askMax, bidMax);
  // 호가 행 = 버튼: 클릭/Enter 로 그 가격을 주문폼에 싣는다(마우스/키보드 동등).
  const row = (l: Level, side: "ask" | "bid", cum: number) => (
    // 접근명은 sr-only 컨텍스트(호가 방향 + 안내)로 가시 숫자를 감싼다. aria-label 로 재작성하면
    // 가시 텍스트(가격+수량)가 접근명에 "연속 포함"되지 않아 WCAG 2.5.3(Label in Name)에 걸린다
    // - 가시 숫자를 그대로 접근명에 담고 부가 설명만 앞뒤 sr-only 로 붙여 규칙을 만족시킨다.
    <button type="button" className={`ob-row ${side}`} key={l.price}
      onClick={() => setPrice(String(l.price))}>
      <span className="ob-bar" style={{ width: `${(cum / max) * 100}%` }} aria-hidden="true" />
      <span className="sr-only">{side === "ask" ? "매도" : "매수"}호가 </span>
      <span className="ob-price num">{formatKRW(l.price)}</span>
      {/* key 에 size 포함 -> 변경 시 remount -> CSS 플래시 재생(JS 타이머 0) */}
      <span className="ob-size num" key={`${l.price}:${l.size}`}>{formatQty(l.size)}</span>
      <span className="sr-only"> 주문가격으로 입력</span>
    </button>
  );
  return (
    <section className="orderbook" aria-label="호가창">
      <h2 className="panel-title">호가</h2>
      <div className="ob-scroll" ref={scrollRef}>
        {[...asks].reverse().map((l, i) => row(l, "ask", askCum[asks.length - 1 - i]))}
        <div className="ob-center num" ref={centerRef}>{formatKRW(snap.price)} <em>현재가</em></div>
        {bids.map((l, i) => row(l, "bid", bidCum[i]))}
      </div>
    </section>
  );
}

"use client";
import { useEffect } from "react";
import Decimal from "decimal.js";
import { useMarketFeed } from "@/store/marketStore";
import { useTradeStore } from "@/store/tradeStore";
import { formatKRW, formatQty } from "@/lib/format";
import type { MarketSnapshot } from "@/lib/mock/data";

// 내 주문(미체결) + 내 체결 - 매칭 엔진 결과의 "눈에 보이는" 실증.
// 시세가 갱신될 때마다 onTick 으로 미체결 지정가가 가로질리는지 평가한다(open -> filled).
const LABEL: Record<string, string> = {
  open: "미체결",
  partially_filled: "부분체결",
  filled: "체결",
  canceled: "취소",
  rejected: "거절",
};

export default function MyOrders({ market, initial }: { market: string; initial: MarketSnapshot }) {
  const snap = useMarketFeed(market, initial)!;
  const onTick = useTradeStore((s) => s.onTick);
  const cancelOrder = useTradeStore((s) => s.cancelOrder);
  const orders = useTradeStore((s) => s.session.orders);
  const fills = useTradeStore((s) => s.session.fills);

  // 시세가 미체결 지정가를 가로지르면 체결(가격만 의존 - 매 틱 1회).
  useEffect(() => { onTick(market, String(snap.price)); }, [snap.price, market, onTick]);

  const open = orders.filter((o) => o.market === market);
  const recent = fills.filter((f) => f.market === market).slice(0, 8);

  return (
    <section className="my-orders" aria-label="내 주문 및 체결">
      <h2 className="panel-title">내 주문 · 체결 <span className="demo-tag">데모</span></h2>

      <div className="mo-group">
        <p className="mo-sub">미체결 ({open.length})</p>
        {open.length === 0 ? (
          <p className="mo-empty">미체결 주문이 없습니다.</p>
        ) : (
          <ul className="mo-list">
            {open.map((o) => (
              <li key={o.id} className={`mo-row ${o.side}`}>
                <span className={`mo-side ${o.side}`}>{o.side === "buy" ? "매수" : "매도"}</span>
                <span className="num">{o.price ? formatKRW(o.price) : "시장가"}</span>
                <span className="num">{formatQty(Number(o.remaining))}</span>
                <span className="mo-status">{LABEL[o.status]}</span>
                <button className="mo-cancel" onClick={() => cancelOrder(o.id)} aria-label="주문 취소">취소</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mo-group">
        <p className="mo-sub">내 체결 ({recent.length})</p>
        {recent.length === 0 ? (
          <p className="mo-empty">체결 내역이 없습니다.</p>
        ) : (
          <ul className="mo-list">
            {recent.map((f, i) => (
              <li key={`${f.orderId}-${i}`} className={`mo-row ${f.side}`}>
                <span className={`mo-side ${f.side}`}>{f.side === "buy" ? "매수" : "매도"}</span>
                <span className="num">{formatKRW(f.price)}</span>
                <span className="num">{formatQty(Number(f.qty))}</span>
                <span className="num mo-amt">{formatKRW(new Decimal(f.price).mul(f.qty))}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

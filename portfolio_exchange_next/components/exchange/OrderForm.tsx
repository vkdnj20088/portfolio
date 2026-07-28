"use client";
import { useEffect, useRef, useState } from "react";
import Decimal from "decimal.js";
import { useMarketFeed } from "@/store/marketStore";
import { useTradeStore } from "@/store/tradeStore";
import { useOrderDraftStore } from "@/store/orderDraftStore";
import { positionOf } from "@/lib/trade/session";
import { formatKRW, formatQty } from "@/lib/format";
import { sanitizeDecimalInput, isPositiveDecimal } from "@/lib/inputSanitize";
import type { MarketSnapshot } from "@/lib/mock/data";
import type { OrderType, Side } from "@/lib/engine/types";

type Result = { kind: "ok" | "error"; text: string } | null;

export default function OrderForm({ market, initial }: { market: string; initial: MarketSnapshot }) {
  const snap = useMarketFeed(market, initial)!;
  const place = useTradeStore((s) => s.place);
  const krw = useTradeStore((s) => s.session.balance.krw);
  const position = useTradeStore((s) => positionOf(s.session, market));

  const [side, setSide] = useState<Side>("buy");
  const [type, setType] = useState<OrderType>("limit");
  const [price, setPrice] = useState<string>(String(initial.price));
  const [qty, setQty] = useState<string>("");
  const [shake, setShake] = useState(false);
  const [result, setResult] = useState<Result>(null);
  const shakeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // 오더북에서 호가를 고르면(클릭/키보드) 그 가격을 지정가로 싣는다.
  // 스토어 구독 콜백(이벤트형)에서 반영 - 렌더 중 setState 가 아니라 외부 이벤트에 대한 동기화다.
  useEffect(() => useOrderDraftStore.subscribe((s, prev) => {
    if (s.seq !== prev.seq && s.price != null) { setPrice(s.price); setType("limit"); }
  }), []);

  const effPrice = type === "market" ? String(snap.price) : price;
  const total = (() => {
    try {
      const t = new Decimal(effPrice || 0).mul(qty || 0);
      return t.isFinite() ? t.floor() : new Decimal(0);
    } catch { return new Decimal(0); }
  })();

  // 비율 버튼 - 매수는 주문가능 현금 기준, 매도는 보유 수량 기준.
  const setPct = (pct: number) => {
    if (side === "buy") {
      let p: Decimal;
      try { p = new Decimal(effPrice || snap.price); } catch { p = new Decimal(snap.price); }
      if (p.lte(0)) return;
      setQty(new Decimal(krw).mul(pct).div(100).div(p).toDecimalPlaces(4, Decimal.ROUND_DOWN).toString());
    } else {
      setQty(new Decimal(position).mul(pct).div(100).toDecimalPlaces(4, Decimal.ROUND_DOWN).toString());
    }
  };

  const submit = () => {
    if (!isPositiveDecimal(qty)) { flashError("수량을 입력해 주세요."); return; }
    // 지정가는 가격도 파싱 가능한 양수여야 place() 하위의 Decimal 파싱이 던지지 않는다.
    if (type === "limit" && !isPositiveDecimal(price)) { flashError("가격을 입력해 주세요."); return; }
    const book = { asks: snap.orderbook.asks, bids: snap.orderbook.bids };
    const r = place(market, side, type, type === "market" ? undefined : price, qty, book);
    if (!r.ok) { flashError(r.reason ?? "주문이 거절되었습니다."); return; }
    setQty("");
    const filled = new Decimal(r.filledQty);
    if (r.status === "filled") {
      setResult({ kind: "ok", text: `${formatQty(filled.toNumber())} 체결 · 평균 ${formatKRW(r.avgPrice ?? "0")}` });
    } else if (filled.gt(0)) {
      setResult({ kind: "ok", text: `부분 체결 ${formatQty(filled.toNumber())} · 잔량 미체결 등록` });
    } else {
      setResult({ kind: "ok", text: "미체결 주문으로 등록 (시세 도달 시 체결)" });
    }
  };

  const flashError = (text: string) => {
    setShake(true);
    if (shakeTimer.current) clearTimeout(shakeTimer.current);
    shakeTimer.current = setTimeout(() => setShake(false), 350);
    setResult({ kind: "error", text });
  };

  // 언마운트(시장 전환 remount 포함) 시 잔여 shake 타임아웃 정리 - setState-after-unmount 방지.
  useEffect(() => () => { if (shakeTimer.current) clearTimeout(shakeTimer.current); }, []);

  return (
    <section className="order-form">
      <div className="of-tabs" role="group" aria-label="매수/매도">
        <button className={side === "buy" ? "on buy" : ""} aria-pressed={side === "buy"} onClick={() => setSide("buy")}>매수</button>
        <button className={side === "sell" ? "on sell" : ""} aria-pressed={side === "sell"} onClick={() => setSide("sell")}>매도</button>
      </div>
      <div className="of-type" role="group" aria-label="주문 유형">
        <button className={type === "limit" ? "on" : ""} onClick={() => setType("limit")} aria-pressed={type === "limit"}>지정가</button>
        <button className={type === "market" ? "on" : ""} onClick={() => setType("market")} aria-pressed={type === "market"}>시장가</button>
      </div>
      <label className="of-row"><span>가격</span>
        <input className="num" inputMode="numeric" value={type === "market" ? "" : price}
          aria-label={type === "market" ? "가격(시장가)" : "주문 가격 (KRW)"}
          placeholder={type === "market" ? "시장가" : ""} disabled={type === "market"}
          onChange={(e) => setPrice(sanitizeDecimalInput(e.target.value))} /></label>
      <label className={`of-row ${shake ? "shake" : ""}`}><span>수량</span>
        <input className="num" inputMode="decimal" placeholder="0" value={qty} aria-label={`주문 수량 (${market})`}
          onChange={(e) => setQty(sanitizeDecimalInput(e.target.value))} /></label>
      <div className="of-pcts" role="group" aria-label={side === "buy" ? "주문가능 대비 비율" : "보유 대비 비율"}>
        {[10, 25, 50, 100].map((p) => (
          <button key={p} onClick={() => setPct(p)}
            aria-label={`${side === "buy" ? "주문가능" : "보유"}의 ${p}%`}>{p}%</button>
        ))}</div>
      <p className="of-total num">총액 <b>{formatKRW(total)}</b> KRW</p>
      <button className={`of-submit ${side}`} onClick={submit}>{side === "buy" ? "매수" : "매도"} 주문</button>
      {result && <p className={`of-result of-result--${result.kind}`} role="status" aria-live="polite">{result.text}</p>}
      <p className="of-balance num">주문가능 {formatKRW(krw)} KRW · 보유 {formatQty(Number(position))} {market} (데모)</p>
    </section>
  );
}

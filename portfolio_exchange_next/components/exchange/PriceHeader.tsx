"use client";
import { useEffect, useRef, useState } from "react";
import { useMarketFeed } from "@/store/marketStore";
import { formatKRW, formatRate } from "@/lib/format";
import { priceSummary } from "@/lib/a11y/announce";
import type { MarketSnapshot } from "@/lib/mock/data";

const ANNOUNCE_INTERVAL_MS = 4000; // 시세 요약 최소 재알림 간격(과다 announce 억제)

export default function PriceHeader({ market, name, initial }: { market: string; name: string; initial: MarketSnapshot }) {
  const snap = useMarketFeed(market, initial)!;
  const dir = snap.changeRate > 0 ? "up" : snap.changeRate < 0 ? "down" : "";

  // 스크린리더 요약: 시세는 600ms 마다 바뀌지만 4초에 1회만 읽어 준다(요약값 위주).
  const [announce, setAnnounce] = useState("");
  const lastRef = useRef(0);
  useEffect(() => {
    const now = performance.now();
    if (now - lastRef.current >= ANNOUNCE_INTERVAL_MS) {
      lastRef.current = now;
      setAnnounce(priceSummary(name, snap.price, snap.changeRate));
    }
  }, [snap.price, snap.changeRate, name]);

  return (
    <section className="price-header" aria-label={`${name} 시세`}>
      {/* 라이브 리전은 하나만 - 개별 갱신 대신 요약 문장을 polite 로 알린다 */}
      <p className="sr-only" role="status" aria-live="polite">{announce}</p>
      <div>
        <h1 className="ph-name">{name} <span className="ph-code">{market}/KRW</span></h1>
        {/* 숫자 시세는 시각용 - 라이브 리전이 대신 읽으므로 SR 에는 감춘다(중복 announce 방지) */}
        <p className={`ph-price num ${dir}`} aria-hidden="true">{formatKRW(snap.price)} <span className="unit">KRW</span></p>
        <p className={`ph-rate num ${dir}`} aria-hidden="true">{formatRate(snap.changeRate)}</p>
      </div>
      <dl className="ph-meta num">
        <div><dt>거래대금(24h)</dt><dd>{formatKRW(snap.volume)} KRW</dd></div>
        <div><dt>호가단위</dt><dd>{formatKRW(snap.orderbook.asks[0].price - snap.price)} KRW</dd></div>
      </dl>
    </section>
  );
}

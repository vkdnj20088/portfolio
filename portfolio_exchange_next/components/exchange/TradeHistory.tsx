"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { marketSource } from "@/lib/sync/marketSource";
import { TICK, type Trade } from "@/lib/mock/data";
import { backfillTrades } from "@/lib/mock/tape";
import { computeWindow } from "@/lib/virtual/window";
import { formatKRW, formatQty } from "@/lib/format";
import type { MarketSnapshot } from "@/lib/mock/data";

// 가상화 상수 - 행 높이는 CSS(.tape-row height)와 반드시 일치해야 한다(계산의 전제).
const ROW_H = 26;
const VIEWPORT_H = 260;
const OVERSCAN = 6;
const BACKFILL = 1200; // 백필 과거 체결 수(가상화 실증용 깊이)
const MAX = 4000; // 버퍼 상한(라이브 누적이 무한정 늘지 않게)

// 결정적 초기 테이프(라이브 + 백필). 시드 난수라 서버/클라 결과가 동일 -> 하이드레이션 정합.
// lazy 초기화라 렌더 중 setState 가 아니다.
function initialTape(market: string, initial: MarketSnapshot): Trade[] {
  const oldest = initial.trades[initial.trades.length - 1]?.ts ?? 0;
  const tick = TICK[market] ?? 1;
  return [...initial.trades, ...backfillTrades(market, BACKFILL, oldest, initial.price, tick)];
}

export default function TradeHistory({ market, initial }: { market: string; initial: MarketSnapshot }) {
  const [tape, setTape] = useState<Trade[]>(() => initialTape(market, initial));
  const [scrollTop, setScrollTop] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastTsRef = useRef(initial.trades[0]?.ts ?? 0);
  const prependRef = useRef(0); // 이번 렌더에서 앞에 추가된 행 수(스크롤 앵커 보정용)
  const rafRef = useRef(0);

  // 라이브 신규 체결을 앞(최신)에 붙인다. 스토어 구독 콜백(이벤트형)에서 setState -
  // 렌더 중 setState 가 아니라 스트림 이벤트에 대한 반영이다.
  useEffect(() => marketSource.subscribe(market, (s) => {
    const newer = s.trades.filter((t) => t.ts > lastTsRef.current);
    if (newer.length === 0) return;
    lastTsRef.current = s.trades[0].ts;
    prependRef.current += newer.length;
    setTape((prev) => [...newer, ...prev].slice(0, MAX));
  }), [market]);

  // 스크롤 앵커링: 위에 k행이 끼어들면, 사용자가 맨 위가 아닐 때 그만큼 scrollTop 을 밀어
  // 보고 있던 체결이 튀지 않게 한다(맨 위면 최신을 계속 보여준다). scrollTop 변경은 scroll
  // 이벤트를 일으켜 onScroll 이 상태를 동기화하므로 여기서 setState 하지 않는다.
  useLayoutEffect(() => {
    const k = prependRef.current;
    prependRef.current = 0;
    const el = scrollRef.current;
    if (k > 0 && el && el.scrollTop > 0) el.scrollTop += k * ROW_H;
  });

  const onScroll = () => {
    if (rafRef.current) return; // rAF 게이팅 - 스크롤당 setState 폭주 방지
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      if (scrollRef.current) setScrollTop(scrollRef.current.scrollTop);
    });
  };
  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);

  const total = tape.length;
  const win = computeWindow({ scrollTop, viewportH: VIEWPORT_H, rowH: ROW_H, total, overscan: OVERSCAN });
  const rows = tape.slice(win.start, win.end);

  return (
    <section className="trades" aria-label="최근 체결 내역">
      <h2 className="panel-title">
        체결
        {/* 성능 계측: 전체가 수천 행이어도 실제 DOM 행 수는 가시영역+오버스캔으로 "상한 고정"된다.
            -> 스크롤해도 리플로우/재조립 비용이 total 에 비례해 커지지 않는 것이 가상화의 핵심 이득. */}
        <span className="tape-stat num">DOM {win.end - win.start}행 / 전체 {total.toLocaleString("ko-KR")}행</span>
      </h2>
      <div className="tr-head" aria-hidden="true"><span>시간</span><span>가격(KRW)</span><span>수량</span></div>
      {/* 비-live: 초당 다수 갱신을 읽으면 소음이라 aria-live 를 두지 않는다(요약은 가격 헤더가 담당). */}
      <div className="tape-scroll" ref={scrollRef} onScroll={onScroll} style={{ height: VIEWPORT_H }}>
        <div style={{ height: win.padTop }} aria-hidden="true" />
        <ul>
          {rows.map((t, i) => (
            <li key={`${t.ts}-${win.start + i}`} className={`tape-row ${t.side === "buy" ? "up" : "down"}`}>
              {/* TZ 고정 - force-dynamic SSR 은 서버 TZ, 클라는 브라우저 TZ 라 미고정 시 시각이 어긋나 하이드레이션 불일치. KRW 거래소이므로 KST 로 결정적 렌더. */}
              <span className="num">{new Date(t.ts).toLocaleTimeString("ko-KR", { hour12: false, timeZone: "Asia/Seoul" })}</span>
              <span className="num">{formatKRW(t.price)}</span>
              <span className="num">{formatQty(t.size)}</span>
            </li>
          ))}
        </ul>
        <div style={{ height: win.padBottom }} aria-hidden="true" />
      </div>
    </section>
  );
}

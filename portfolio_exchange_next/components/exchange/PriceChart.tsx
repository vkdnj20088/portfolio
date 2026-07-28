"use client";
import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";
import type { IChartApi, ISeriesApi, UTCTimestamp } from "lightweight-charts";
import { COINS, TICK } from "@/lib/mock/data";
import { useMarketFeed } from "@/store/marketStore";

type Candle = { time: number; open: number; high: number; low: number; close: number };

// 차트의 중립 크롬(텍스트/그리드/보더)만 테마에 맞춘다 - 캔들의 한국식 등락색(빨강/파랑)은 기능색이라
// 불변. 값은 앱 토큰(--text-sub 라이트 #666 / 다크 #a9a9a9)과 결을 맞춘 뉴트럴이다.
const CHART_CHROME = (dark: boolean) =>
  dark
    ? { text: "#a9a9a9", grid: "rgba(255,255,255,.06)", border: "rgba(255,255,255,.14)" }
    : { text: "#666666", grid: "rgba(0,0,0,.06)", border: "rgba(0,0,0,.14)" };

export default function PriceChart({ market }: { market: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const { resolvedTheme } = useTheme();
  // 현재(마지막) 분봉의 진행 상태 - 라이브 틱이 여기에 누적된다
  const curRef = useRef<(Candle & { last: number; vol: number }) | null>(null);
  const snap = useMarketFeed(market); // 라이브 시세 구독

  // 차트 생성(마운트 / 마켓 변경 시)
  useEffect(() => {
    let chart: IChartApi | null = null;
    let dead = false;
    candleRef.current = null; volRef.current = null; curRef.current = null;
    (async () => {
      const { createChart, CandlestickSeries, HistogramSeries } = await import("lightweight-charts");
      if (dead || !ref.current) return;
      // 생성 시점 테마는 DOM(next-themes 가 하이드레이션 전 data-theme 를 심는다)에서 읽는다 -
      // resolvedTheme 을 이 effect 의존성에 넣으면 테마 토글마다 차트를 통째로 재생성하게 된다.
      // 토글 반영은 아래 별도 effect 가 applyOptions 로 처리한다.
      const t = CHART_CHROME(document.documentElement.getAttribute("data-theme") === "dark");
      chart = createChart(ref.current, {
        autoSize: true,
        layout: { background: { color: "transparent" }, textColor: t.text, fontSize: 11 },
        grid: { vertLines: { color: t.grid }, horzLines: { color: t.grid } },
        rightPriceScale: { borderColor: t.border },
        timeScale: { borderColor: t.border, timeVisible: true },
      });
      chartRef.current = chart;
      const base = COINS.find((c) => c.id === market)?.base ?? 100;
      const tick = TICK[market] ?? 1;
      let p = base * 0.97; let seed = base;
      const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
      const now = Math.floor(Date.now() / 1000 / 60) * 60;
      const candles: Candle[] = Array.from({ length: 120 }, (_, i) => {
        const o = p; p = Math.max(tick, Math.round((p * (1 + (rand() - 0.48) * 0.006)) / tick) * tick); const c = p;
        return { time: now - (120 - i) * 60, open: o,
          high: Math.max(o, c) * (1 + rand() * 0.001), low: Math.min(o, c) * (1 - rand() * 0.001), close: c };
      });
      // v5: addSeries(SeriesDefinition, options) - v4 addCandlestickSeries 는 제거됨
      const cs = chart.addSeries(CandlestickSeries, {
        upColor: "#d60000", downColor: "#133fc7", borderVisible: false, // 한국식 등락색
        wickUpColor: "#d60000", wickDownColor: "#133fc7",
      });
      cs.setData(candles.map((c) => ({ ...c, time: c.time as UTCTimestamp })));
      const vs = chart.addSeries(HistogramSeries, { priceScaleId: "vol", color: "rgba(247,145,29,.35)" });
      chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      vs.setData(candles.map((c) => ({ time: c.time as UTCTimestamp, value: Math.abs(c.close - c.open) * (10 + rand() * 20),
        color: c.close >= c.open ? "rgba(214,0,0,.35)" : "rgba(19,63,199,.35)" })));
      chart.timeScale().fitContent();

      candleRef.current = cs; volRef.current = vs;
      const last = candles[candles.length - 1];
      curRef.current = { ...last, last: last.close, vol: 0 };
    })();
    return () => {
      dead = true; chart?.remove();
      chartRef.current = null; candleRef.current = null; volRef.current = null; curRef.current = null;
    };
  }, [market]);

  // 테마 토글 반영: 차트를 재생성하지 않고 중립 크롬(텍스트/그리드/보더)만 applyOptions 로 갈아끼운다.
  useEffect(() => {
    const c = chartRef.current;
    if (!c) return;
    const t = CHART_CHROME(resolvedTheme === "dark");
    c.applyOptions({
      layout: { textColor: t.text },
      grid: { vertLines: { color: t.grid }, horzLines: { color: t.grid } },
      rightPriceScale: { borderColor: t.border },
      timeScale: { borderColor: t.border },
    });
  }, [resolvedTheme]);

  // 라이브 갱신: 시세 스냅샷을 현재 분봉에 반영(같은 분=갱신 / 새 분=롤오버)
  useEffect(() => {
    const cs = candleRef.current; const cur = curRef.current;
    if (!cs || !cur || !snap) return;
    const price = snap.price;
    const minute = Math.floor(Date.now() / 60000) * 60;
    if (minute > cur.time) {
      // 새 분 -> 새 캔들 시작(시가=직전 종가)
      const nc = { time: minute, open: cur.close, high: price, low: price, close: price, last: price, vol: 0 };
      curRef.current = nc;
      cs.update({ time: minute as UTCTimestamp, open: nc.open, high: nc.high, low: nc.low, close: nc.close });
      volRef.current?.update({ time: minute as UTCTimestamp, value: 0.0001, color: "rgba(214,0,0,.35)" });
    } else {
      // 같은 분 -> 고저/종가 갱신
      cur.high = Math.max(cur.high, price);
      cur.low = Math.min(cur.low, price);
      cur.vol += Math.abs(price - cur.last);
      cur.last = price;
      cur.close = price;
      cs.update({ time: cur.time as UTCTimestamp, open: cur.open, high: cur.high, low: cur.low, close: cur.close });
      const up = cur.close >= cur.open;
      volRef.current?.update({ time: cur.time as UTCTimestamp, value: cur.vol * 12 + Math.abs(cur.close - cur.open) * 8,
        color: up ? "rgba(214,0,0,.35)" : "rgba(19,63,199,.35)" });
    }
  }, [snap]);

  return <div className="chart-box" ref={ref} />;
}

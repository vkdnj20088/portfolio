"use client";
import { useEffect } from "react";
import Decimal from "decimal.js";
import { HOLDINGS } from "@/lib/mock/data";
import { mockEngine } from "@/lib/mock/stream";
import { useMarketStore } from "@/store/marketStore";
import { formatKRW, formatQty, formatRate } from "@/lib/format";
import type { MarketSnapshot } from "@/lib/mock/data";
// 보유코인 전체를 한 번에 구독(고정 배열) -> .map 안 hooks 호출 회피(rules-of-hooks 안전)
function useHoldingsFeed(): Record<string, MarketSnapshot> {
  const apply = useMarketStore((s) => s.apply);
  useEffect(() => {
    const unsubs = HOLDINGS.map((h) => mockEngine.subscribe(h.coin, (snap) => apply(h.coin, snap)));
    return () => unsubs.forEach((u) => u());
  }, [apply]);
  return useMarketStore((s) => s.snapshots);
}
export default function AssetsView() {
  const snapshots = useHoldingsFeed();
  const rows = HOLDINGS.map((h) => {
    const price = snapshots[h.coin]?.price ?? h.avgBuy;
    const buy = new Decimal(h.avgBuy).mul(h.qty);
    const evalAmt = new Decimal(price).mul(h.qty);
    const pnl = evalAmt.minus(buy);
    const rate = buy.gt(0) ? pnl.div(buy).mul(100).toNumber() : 0;
    return { h, buy, evalAmt, pnl, rate };
  });
  const totalBuy = rows.reduce((a, r) => a.plus(r.buy), new Decimal(0));
  const totalEval = rows.reduce((a, r) => a.plus(r.evalAmt), new Decimal(0));
  const totalPnl = totalEval.minus(totalBuy);
  const totalRate = totalBuy.gt(0) ? totalPnl.div(totalBuy).mul(100).toNumber() : 0;
  const tdir = totalRate > 0 ? "up" : totalRate < 0 ? "down" : "";
  return (
    <div className="assets-page">
      <h1 className="page-h1">보유자산</h1>
      <section className="asset-summary">
        <div className="sum-cell"><dt>총 매수금액</dt><dd className="num">{formatKRW(totalBuy)} <span className="unit">KRW</span></dd></div>
        <div className="sum-cell"><dt>총 평가금액</dt><dd className="num">{formatKRW(totalEval)} <span className="unit">KRW</span></dd></div>
        <div className="sum-cell"><dt>총 평가손익</dt><dd className={`num ${tdir}`}>{totalPnl.gte(0) ? "+" : ""}{formatKRW(totalPnl)} <span className="unit">KRW</span></dd></div>
        <div className="sum-cell"><dt>총 수익률</dt><dd className={`num ${tdir}`}>{formatRate(totalRate)}</dd></div>
      </section>
      <section className="asset-table-wrap">
        <table className="asset-table">
          <thead><tr>
            <th className="center">보유 코인</th><th className="center">보유수량</th>
            <th className="center">매수평균가</th><th className="center">평가금액</th><th className="center">평가손익</th>
          </tr></thead>
          <tbody>
            {rows.map(({ h, evalAmt, pnl, rate }) => {
              const dir = rate > 0 ? "up" : rate < 0 ? "down" : "";
              return (
                <tr key={h.coin}>
                  <td className="left"><b>{h.name}</b><em>{h.coin}</em></td>
                  <td className="right num">{formatQty(h.qty, 4)}</td>
                  <td className="right num">{formatKRW(h.avgBuy)}</td>
                  <td className="right num">{formatKRW(evalAmt)}</td>
                  <td className={`right num ${dir}`}>{pnl.gte(0) ? "+" : ""}{formatKRW(pnl)}<span className="sub">{formatRate(rate)}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      <p className="mock-note">· 평가금액·손익은 데모 실시간 시세 기준 추정값입니다. (실서비스 아님)</p>
    </div>
  );
}

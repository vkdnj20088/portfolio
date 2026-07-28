import { notFound } from "next/navigation";
import dynamic from "next/dynamic";
import { COINS, buildInitialSnapshot } from "@/lib/mock/data";
import CoinList from "@/components/exchange/CoinList";
import PriceHeader from "@/components/exchange/PriceHeader";
import OrderBook from "@/components/exchange/OrderBook";
import OrderForm from "@/components/exchange/OrderForm";
import MyOrders from "@/components/exchange/MyOrders";
import TradeHistory from "@/components/exchange/TradeHistory";
const PriceChart = dynamic(() => import("@/components/exchange/PriceChart")); // ssr 자동분리
export function generateStaticParams() { return COINS.map((c) => ({ market: c.id })); }
export default async function ExchangePage({ params }: { params: Promise<{ market: string }> }) {
  const { market } = await params;                 // Next15+: params 는 Promise
  const meta = COINS.find((c) => c.id === market);
  if (!meta) notFound();
  const initial = buildInitialSnapshot(market);    // 서버 초기 데이터
  return (
    <div className="exchange-grid">
      <aside className="col-list"><CoinList current={market} /></aside>
      <main className="col-main">
        <PriceHeader market={market} name={meta.name} initial={initial} />
        <div className="chart-wrap"><PriceChart market={market} /></div>
        {/* key={market}: 시장 전환은 같은 [market] 세그먼트라 클라 네비게이션 시 컴포넌트 인스턴스가
            보존된다. 테이프/가격을 lazy useState 로 초기화하는 이 둘은 그때 재초기화되지 않아 이전
            시장 데이터가 남는다(체결 혼재/이전가 잔존). key 로 이 둘만 remount 해 상태를 리셋한다
            - 이펙트 의존성으로 구동되는 차트/오더북/헤더는 remount 불필요하므로 건드리지 않는다. */}
        <TradeHistory key={market} market={market} initial={initial} />
      </main>
      <aside className="col-side">
        <OrderBook market={market} initial={initial} />
        <OrderForm key={market} market={market} initial={initial} />
        <MyOrders market={market} initial={initial} />
      </aside>
    </div>
  );
}

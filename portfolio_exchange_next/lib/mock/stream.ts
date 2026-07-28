// 실 이관 시 이 파일만 lib/ws/stompClient.ts 로 교체 -> 컴포넌트 무수정 (§11.4)
import { buildInitialSnapshot, buildOrderbook, COINS, TICK, type Level, type MarketSnapshot } from "./data";
import { hashSeed, mulberry32 } from "../rng";
type Listener = (s: MarketSnapshot) => void;
class MockMarketEngine {
  private state = new Map<string, MarketSnapshot>();
  private listeners = new Map<string, Set<Listener>>();
  private timers = new Map<string, ReturnType<typeof setInterval>>();
  subscribe(market: string, cb: Listener): () => void {
    if (typeof window === "undefined") return () => {}; // SSR 가드
    let set = this.listeners.get(market);
    if (!set) { set = new Set(); this.listeners.set(market, set); }
    set.add(cb);
    if (!this.timers.has(market)) this.start(market);
    const cur = this.state.get(market); if (cur) cb(cur);
    return () => { set!.delete(cb); if (set!.size === 0) { clearInterval(this.timers.get(market)); this.timers.delete(market); } };
  }
  private start(market: string) {
    if (!this.state.has(market)) this.state.set(market, buildInitialSnapshot(market));
    const tick = TICK[market] ?? 1;
    const base = COINS.find((c) => c.id === market)?.base ?? 1;
    // 마켓별 시드 난수 - 라이브 스트림도 결정적으로(같은 심볼은 항상 같은 가격 흐름).
    // Math.random 이면 매 로드가 달라 재현/스냅샷 테스트가 불가능했다. 심볼 해시를 시드로
    // 고정해 데모/테스트를 재현 가능하게 만든다(§0 목업, 실시세와 무관).
    const rand = mulberry32(hashSeed(market));
    this.timers.set(market, setInterval(() => {
      const prev = this.state.get(market)!;
      const drift = (rand() - 0.5) * 0.0024;
      const price = Math.max(tick, Math.round((prev.price * (1 + drift)) / tick) * tick);
      const side: "buy" | "sell" = price >= prev.price ? "buy" : "sell";
      const trade = { price, size: +(rand() * 0.6 + 0.01).toFixed(3), side, ts: Date.now() };
      // 가격축은 새 mid 로 재배열하되 기존 size 유지 + 틱당 4개만 변동(플래시가 스트로브 되는 것 방지)
      const prevMap = new Map<number, number>();
      prev.orderbook.asks.concat(prev.orderbook.bids).forEach((l) => prevMap.set(l.price, l.size));
      const fresh = buildOrderbook(price, tick, rand);
      const keep = (l: Level): Level => ({ price: l.price, size: prevMap.get(l.price) ?? l.size });
      const asks = fresh.asks.map(keep), bids = fresh.bids.map(keep);
      for (let k = 0; k < 4; k++) {
        const arr = rand() > 0.5 ? asks : bids;
        const i = Math.floor(rand() * arr.length);
        arr[i] = { price: arr[i].price, size: +(rand() * 2 + 0.05).toFixed(3) };
      }
      const next: MarketSnapshot = {
        ...prev, price, changeRate: +((price / base - 1) * 100).toFixed(2),
        volume: prev.volume + Math.round(price * trade.size),
        orderbook: { asks, bids }, trades: [trade, ...prev.trades].slice(0, 30),
      };
      this.state.set(market, next);
      this.listeners.get(market)?.forEach((l) => l(next));
    }, 600));
  }
}
export const mockEngine = new MockMarketEngine();

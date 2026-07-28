// 목업 전용 시장 데이터 - 실서비스 데이터/엔드포인트와 무관 (§0)
export interface CoinMeta { id: string; name: string; base: number; changeInit: number; }
export const COINS: CoinMeta[] = [
  { id: "BTC", name: "비트코인", base: 95_432_000, changeInit: 2.34 },
  { id: "ETH", name: "이더리움", base: 5_120_000, changeInit: -1.12 },
  { id: "XRP", name: "리플", base: 3_120, changeInit: 5.67 },
  { id: "SOL", name: "솔라나", base: 312_400, changeInit: -0.45 },
  { id: "DOGE", name: "도지코인", base: 512, changeInit: 8.9 },
];
export const TICK: Record<string, number> = { BTC: 1000, ETH: 500, XRP: 1, SOL: 100, DOGE: 1 };
export const DEPTH = 20; // 호가 20단(실서비스 10->20 확장 이력)
export interface Level { price: number; size: number; }
export interface Orderbook { asks: Level[]; bids: Level[]; }
export interface Trade { price: number; size: number; side: "buy" | "sell"; ts: number; }
export interface MarketSnapshot {
  market: string; price: number; changeRate: number; volume: number;
  orderbook: Orderbook; trades: Trade[];
}
// 시드 난수 - 서버 초기 스냅샷을 결정적으로(하이드레이션 안정)
function seeded(seed: number) {
  return () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
}
export function buildOrderbook(mid: number, tick: number, rand: () => number): Orderbook {
  const mk = (side: 1 | -1) =>
    Array.from({ length: DEPTH }, (_, i) => ({ price: mid + side * tick * (i + 1), size: +(rand() * 2 + 0.05).toFixed(3) }));
  return { asks: mk(1), bids: mk(-1) };
}
export function buildInitialSnapshot(id: string): MarketSnapshot {
  const meta = COINS.find((c) => c.id === id) ?? COINS[0];
  const rand = seeded(meta.base);
  const price = meta.base, tick = TICK[meta.id] ?? 1;
  return {
    market: meta.id, price, changeRate: meta.changeInit,
    volume: Math.round(price * 1500 * (1 + rand())),
    orderbook: buildOrderbook(price, tick, rand),
    trades: Array.from({ length: 20 }, (_, i) => ({
      price: price + (rand() > 0.5 ? 1 : -1) * tick * Math.ceil(rand() * 3),
      size: +(rand() * 0.8 + 0.01).toFixed(3),
      side: rand() > 0.5 ? ("buy" as const) : ("sell" as const),
      ts: Date.now() - i * 1700,
    })),
  };
}

// 보유내역(§13.2) - 보유자산 화면용 더미
export interface Holding { coin: string; name: string; qty: number; avgBuy: number; }
export const HOLDINGS: Holding[] = [
  { coin: "BTC", name: "비트코인", qty: 0.1523, avgBuy: 91_200_000 },
  { coin: "ETH", name: "이더리움", qty: 2.10, avgBuy: 5_300_000 },
  { coin: "XRP", name: "리플", qty: 4200, avgBuy: 2_950 },
  { coin: "SOL", name: "솔라나", qty: 12.4, avgBuy: 305_000 },
];

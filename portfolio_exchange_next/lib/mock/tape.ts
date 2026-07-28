// 깊은 체결 테이프용 결정적 백필 - 가상화를 실증하려면 수백~수천 행이 필요한데, 라이브 스트림은
// 틱당 1건뿐이라 즉시 깊어지지 않는다. 그래서 시드 난수로 "과거 체결"을 재현 가능하게 생성한다
// (§0 목업 - 실체결과 무관). 최신(가장 최근 과거)이 배열 앞에 오도록 ts 를 내림차순으로 만든다.
import { mulberry32, hashSeed } from "../rng";
import type { Trade } from "./data";

export function backfillTrades(
  market: string,
  count: number,
  beforeTs: number,
  basePrice: number,
  tick: number,
): Trade[] {
  const rand = mulberry32(hashSeed(market + ":tape"));
  const out: Trade[] = [];
  let price = basePrice;
  for (let i = 0; i < count; i++) {
    const drift = (rand() - 0.5) * 0.002;
    price = Math.max(tick, Math.round((price * (1 + drift)) / tick) * tick);
    out.push({
      price,
      size: +(rand() * 0.6 + 0.01).toFixed(3),
      side: rand() > 0.5 ? "buy" : "sell",
      ts: beforeTs - (i + 1) * 1500, // 과거로 내려가며 1.5s 간격
    });
  }
  return out;
}

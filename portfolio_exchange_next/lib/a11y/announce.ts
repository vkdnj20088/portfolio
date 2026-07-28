import { formatKRW } from "../format";

// 스크린리더용 한 문장 요약. 시세는 600ms 마다 바뀌지만 이 문자열을 throttle 해서
// 읽히므로(예: 4초 1회), 개별 갱신을 쏟아내지 않고 "지금 상태"만 간결히 알린다.
export function priceSummary(name: string, price: number | string, changeRate: number): string {
  const dir = changeRate > 0 ? "상승" : changeRate < 0 ? "하락" : "보합";
  const rate = `${changeRate > 0 ? "+" : ""}${changeRate.toFixed(2)}%`;
  return `${name} ${formatKRW(price)}원 ${rate} ${dir}`;
}

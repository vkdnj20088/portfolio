import Decimal from "decimal.js";
export const formatKRW = (v: number | string | Decimal) =>
  new Decimal(v).floor().toNumber().toLocaleString("ko-KR"); // KRW=floor (실서비스 정책)
export const formatQty = (v: number, dp = 3) => v.toFixed(dp);
export const formatRate = (r: number) => `${r > 0 ? "+" : ""}${r.toFixed(2)}%`;

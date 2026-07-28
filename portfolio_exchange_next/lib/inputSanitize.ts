import Decimal from "decimal.js";

// 십진 입력 정제 - 숫자와 "첫 소수점 하나"만 남긴다.
// 왜: 기존 정제(/[^\d.]/g)는 소수점을 여러 개 통과시켜 "1.2.3" 같은 값이 그대로 상태에 들어갔고,
// 그 값을 new Decimal(...) 로 파싱하는 순간 DecimalError 가 던져져 주문/출금 핸들러가 크래시했다.
// 두 번째 이후 점을 제거해 파싱 불가 입력의 발생 자체를 막는다. 유효 입력("1.5","0.001")은 무변.
export function sanitizeDecimalInput(raw: string): string {
  const cleaned = raw.replace(/[^\d.]/g, "");
  const dot = cleaned.indexOf(".");
  if (dot === -1) return cleaned;
  return cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, "");
}

// 값이 파싱 가능한 "양수"인지 안전 판정. 소비 지점(제출/비율)에서 new Decimal 직접 호출을 대체해
// 남은 엣지("." 단독, 빈 문자열 등)에서도 크래시 대신 정상 거절이 되게 한다.
export function isPositiveDecimal(raw: string): boolean {
  try {
    const d = new Decimal(raw);
    return d.isFinite() && d.gt(0);
  } catch {
    return false;
  }
}

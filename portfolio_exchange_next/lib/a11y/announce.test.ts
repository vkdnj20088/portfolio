import { describe, expect, it } from "vitest";
import { priceSummary } from "./announce";

describe("priceSummary - 스크린리더 요약", () => {
  it("상승 시 방향/부호/천단위 포맷", () => {
    expect(priceSummary("비트코인", 95432000, 2.34)).toBe("비트코인 95,432,000원 +2.34% 상승");
  });
  it("하락 시 음수 부호", () => {
    expect(priceSummary("이더리움", 5120000, -1.12)).toBe("이더리움 5,120,000원 -1.12% 하락");
  });
  it("보합(0%)", () => {
    expect(priceSummary("리플", 3120, 0)).toBe("리플 3,120원 0.00% 보합");
  });
});

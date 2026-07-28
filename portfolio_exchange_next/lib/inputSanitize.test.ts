import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { sanitizeDecimalInput, isPositiveDecimal } from "./inputSanitize";

describe("sanitizeDecimalInput", () => {
  it("leaves valid numeric input unchanged", () => {
    expect(sanitizeDecimalInput("123")).toBe("123");
    expect(sanitizeDecimalInput("1.5")).toBe("1.5");
    expect(sanitizeDecimalInput("0.0001")).toBe("0.0001");
    expect(sanitizeDecimalInput("")).toBe("");
    expect(sanitizeDecimalInput("0.")).toBe("0."); // 타이핑 중간값 보존
  });

  it("strips non-numeric characters (기존 정제와 동일)", () => {
    expect(sanitizeDecimalInput("1a2b")).toBe("12");
    expect(sanitizeDecimalInput("1,234")).toBe("1234");
    expect(sanitizeDecimalInput(" 9 ")).toBe("9");
  });

  it("collapses extra dots to the first one (크래시 근원 차단)", () => {
    expect(sanitizeDecimalInput("1.2.3")).toBe("1.23");
    expect(sanitizeDecimalInput("1.2.3.4")).toBe("1.234");
    expect(sanitizeDecimalInput("1..")).toBe("1.");
    expect(sanitizeDecimalInput("..")).toBe(".");
  });

  it("정제 결과는 new Decimal 을 던지지 않는다(단독 '.' 제외) - 회귀 가드", () => {
    for (const raw of ["1.2.3", "9.9.9", "12..34", "5.5.5.5"]) {
      const out = sanitizeDecimalInput(raw);
      expect(() => new Decimal(out)).not.toThrow();
    }
  });
});

describe("isPositiveDecimal", () => {
  it("accepts positive parseable numbers", () => {
    expect(isPositiveDecimal("1")).toBe(true);
    expect(isPositiveDecimal("0.001")).toBe(true);
  });
  it("rejects non-positive / unparseable without throwing", () => {
    expect(isPositiveDecimal("")).toBe(false);
    expect(isPositiveDecimal("0")).toBe(false);
    expect(isPositiveDecimal(".")).toBe(false); // 단독 점: 크래시 대신 거절
    expect(isPositiveDecimal("-3")).toBe(false);
    expect(isPositiveDecimal("abc")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { hashSeed, mulberry32 } from "./rng";

describe("mulberry32 - 결정적 PRNG", () => {
  it("같은 시드는 같은 시퀀스를 낸다(재현 가능)", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 8 }, () => a());
    const seqB = Array.from({ length: 8 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("다른 시드는 다른 시퀀스를 낸다", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(a()).not.toBe(b());
  });

  it("출력은 [0,1) 범위", () => {
    const r = mulberry32(123);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("hashSeed - 문자열 -> 시드", () => {
  it("같은 문자열은 같은 시드(안정)", () => {
    expect(hashSeed("BTC")).toBe(hashSeed("BTC"));
  });
  it("다른 문자열은(대개) 다른 시드", () => {
    expect(hashSeed("BTC")).not.toBe(hashSeed("ETH"));
  });
});

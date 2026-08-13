import { describe, expect, it } from 'vitest';
import {
  VERDICT_LABEL,
  bootstrapDiffCi,
  mcnemarExact,
  power,
  selfSpread,
  spreadsOverlap,
  verdictOf,
} from './stats';
import type { PairedObservation } from './stats';

/** b쌍은 A만 통과, c쌍은 B만 통과, rest 는 둘 다 통과(검정에 안 들어감). */
function pairs(b: number, c: number, both = 0): PairedObservation[] {
  const out: PairedObservation[] = [];
  let i = 0;
  for (let k = 0; k < b; k += 1) out.push({ caseId: `c${i++}`, runIndex: 0, a: true, b: false });
  for (let k = 0; k < c; k += 1) out.push({ caseId: `c${i++}`, runIndex: 0, a: false, b: true });
  for (let k = 0; k < both; k += 1) out.push({ caseId: `c${i++}`, runIndex: 0, a: true, b: true });
  return out;
}

describe('McNemar 정확검정', () => {
  it('손계산과 맞는다 - 불일치 12:5 이면 양측 p = 0.1435', () => {
    // P(X<=5 | n=17, p=0.5) = 9402/131072 = 0.0717316, 양측이므로 2배.
    const r = mcnemarExact(pairs(12, 5));
    expect(r.discordant).toBe(17);
    expect(r.pValue).toBeCloseTo(0.14346, 5);
  });

  it('한쪽으로 6쌍이 몰리면 유의에 막 도달한다 - 2 x 0.5^6 = 0.03125', () => {
    expect(mcnemarExact(pairs(6, 0)).pValue).toBeCloseTo(0.03125, 6);
    // 5쌍이면 못 넘는다. 이 경계가 검정력 계산의 근거다.
    expect(mcnemarExact(pairs(5, 0)).pValue).toBeCloseTo(0.0625, 6);
  });

  it('일치 쌍은 검정에 들어가지 않는다 - 둘 다 통과한 케이스는 정보가 없다', () => {
    expect(mcnemarExact(pairs(3, 2, 50)).pValue).toBe(mcnemarExact(pairs(3, 2)).pValue);
  });

  it('불일치가 없으면 p = 1', () => {
    expect(mcnemarExact(pairs(0, 0, 10)).pValue).toBe(1);
  });

  it('A/B 를 바꾸면 p 는 그대로다 - 양측 검정이므로 방향을 묻지 않는다', () => {
    const forward = mcnemarExact(pairs(9, 3));
    const swapped = mcnemarExact(pairs(3, 9));
    expect(swapped.pValue).toBe(forward.pValue);
    expect(swapped.bOnlyFail).toBe(forward.aOnlyFail);
  });

  it('같은 비율이라도 표본이 커지면 p 는 줄어든다', () => {
    const small = mcnemarExact(pairs(4, 1)).pValue;
    const big = mcnemarExact(pairs(16, 4)).pValue;
    expect(big).toBeLessThan(small);
  });
});

describe('부트스트랩 신뢰구간', () => {
  const sample = pairs(2, 8, 6);

  it('같은 시드면 같은 구간이다 - 화면을 열 때마다 값이 흔들리면 안 된다', () => {
    const x = bootstrapDiffCi(sample, 42, 500);
    const y = bootstrapDiffCi(sample, 42, 500);
    expect([x.low, x.high]).toEqual([y.low, y.high]);
  });

  it('시드를 바꾸면 구간이 조금 움직이되 폭은 비슷하다', () => {
    const x = bootstrapDiffCi(sample, 1, 2000);
    const y = bootstrapDiffCi(sample, 2, 2000);
    const wx = x.high - x.low;
    const wy = y.high - y.low;
    expect(Math.abs(wx - wy)).toBeLessThan(0.25);
  });

  it('구간이 추정치를 포함한다', () => {
    const r = bootstrapDiffCi(sample, 7, 1000);
    expect(r.low).toBeLessThanOrEqual(r.estimate);
    expect(r.high).toBeGreaterThanOrEqual(r.estimate);
  });

  it('A/B 를 바꾸면 부호만 뒤집힌다', () => {
    const flipped = sample.map((p) => ({ ...p, a: p.b, b: p.a }));
    const x = bootstrapDiffCi(sample, 3, 1000);
    const y = bootstrapDiffCi(flipped, 3, 1000);
    expect(y.estimate).toBeCloseTo(-x.estimate, 10);
  });

  it('차이가 전혀 없으면 구간이 0 하나로 닫힌다', () => {
    const r = bootstrapDiffCi(pairs(0, 0, 12), 5, 500);
    expect(r.estimate).toBe(0);
    expect(r.low).toBe(0);
    expect(r.high).toBe(0);
  });

  it('케이스 단위로 재표집한다 - 같은 케이스의 반복은 함께 뽑힌다', () => {
    // 실행 단위로 뽑으면 표본이 실제보다 많은 척하게 되어 구간이 좁아진다.
    const clustered: PairedObservation[] = [0, 1, 2].map((runIndex) => ({
      caseId: 'only-one-case',
      runIndex,
      a: true,
      b: false,
    }));
    const r = bootstrapDiffCi(clustered, 11, 500);
    // 케이스가 하나뿐이면 어떤 재표집도 같은 묶음을 뽑으므로 구간이 한 점이다.
    expect(r.low).toBe(r.high);
  });
});

describe('검정력', () => {
  it('유의에 필요한 최소 불일치 쌍은 6이다', () => {
    expect(power(30).minDiscordant).toBe(6);
  });

  it('표본이 커질수록 볼 수 있는 최소 차이가 작아진다', () => {
    expect(power(60).minDetectableDiff).toBeLessThan(power(30).minDetectableDiff);
  });

  it('표본이 없으면 아무 차이도 못 본다고 말한다', () => {
    expect(power(0).minDetectableDiff).toBe(1);
  });
});

describe('판정 문구', () => {
  const pw = power(30);

  it('불일치가 최소치에 못 미치면 판정 불가다 - 차이 없음이 아니다', () => {
    const m = mcnemarExact(pairs(2, 1));
    const ci = bootstrapDiffCi(pairs(2, 1), 1, 200);
    expect(verdictOf(m, ci, pw)).toBe('insufficient');
    expect(VERDICT_LABEL.insufficient).toContain('표본이 모자라');
  });

  it('p 가 작고 구간이 0 을 배제하면 신호다', () => {
    const sample = pairs(0, 9, 3);
    const m = mcnemarExact(sample);
    const ci = bootstrapDiffCi(sample, 1, 2000);
    expect(m.pValue).toBeLessThan(0.05);
    expect(verdictOf(m, ci, pw)).toBe('signal');
  });

  it('구간이 0 을 포함하면 p 와 무관하게 잡음이다 - 두 근거가 어긋나면 보수적으로 간다', () => {
    const m = { bOnlyFail: 1, aOnlyFail: 7, discordant: 8, pValue: 0.01 };
    const ci = { estimate: 0.2, low: -0.05, high: 0.4, iterations: 100, seed: 1 };
    expect(verdictOf(m, ci, pw)).toBe('noise');
  });
});

describe('자기 분산', () => {
  const scores = [
    { variantId: 'A', runIndex: 0, passed: true },
    { variantId: 'A', runIndex: 0, passed: false },
    { variantId: 'A', runIndex: 1, passed: true },
    { variantId: 'A', runIndex: 1, passed: true },
    { variantId: 'B', runIndex: 0, passed: false },
    { variantId: 'B', runIndex: 0, passed: false },
    { variantId: 'B', runIndex: 1, passed: true },
    { variantId: 'B', runIndex: 1, passed: false },
  ];

  it('회차별 통과율과 그 범위를 낸다', () => {
    const a = selfSpread(scores, 'A');
    expect(a.perRun.map((r) => r.rate)).toEqual([0.5, 1]);
    expect([a.low, a.high]).toEqual([0.5, 1]);
  });

  it('두 구성의 범위가 겹치는지 말한다 - 겹치면 평균 차이는 눈으로도 의미가 없다', () => {
    expect(spreadsOverlap(selfSpread(scores, 'A'), selfSpread(scores, 'B'))).toBe(true);
    const apart = spreadsOverlap(
      { variantId: 'A', perRun: [], low: 0.8, high: 0.9 },
      { variantId: 'B', perRun: [], low: 0.1, high: 0.2 },
    );
    expect(apart).toBe(false);
  });
});

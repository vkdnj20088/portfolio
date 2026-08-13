/**
 * 회귀인가 잡음인가를 가르는 계산.
 *
 * 이 층이 없으면 평가 화면은 "A 62%, B 68%" 같은 표가 되고, 읽는 사람은 6%p 가 개선인지
 * 우연인지 알 수 없다. 알 수 없는 것을 표로 만들면 알 수 있는 것처럼 보인다는 게 문제다.
 *
 * 계산은 전부 커밋된 판정 배열 위의 순수 함수다. 부트스트랩만 난수를 쓰는데 시드를 고정하므로
 * (작업 릴레이·티커와 같은 규약) 신뢰구간은 언제 열어도 같은 값이다.
 */

// ---------------------------------------------------------------------------
// 시드 난수 - 부트스트랩이 매번 다른 구간을 내지 않게
// ---------------------------------------------------------------------------

/** mulberry32. 짧고 결정적이면 충분하다 - 암호 용도가 아니다. */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// 쌍대 검정
// ---------------------------------------------------------------------------

/** 같은 케이스를 두 구성이 모두 푼 쌍 하나. */
export interface PairedObservation {
  caseId: string;
  runIndex: number;
  a: boolean;
  b: boolean;
}

export interface McNemarResult {
  /** A 만 통과한 쌍. */
  bOnlyFail: number;
  /** B 만 통과한 쌍. */
  aOnlyFail: number;
  discordant: number;
  pValue: number;
}

function logFactorial(n: number): number {
  let s = 0;
  for (let i = 2; i <= n; i += 1) s += Math.log(i);
  return s;
}

function binomialTailAtMost(k: number, n: number): number {
  // P(X <= k), X ~ Bin(n, 0.5). n 이 작아 로그 팩토리얼로 충분하다.
  let sum = 0;
  for (let i = 0; i <= k; i += 1) {
    sum += Math.exp(logFactorial(n) - logFactorial(i) - logFactorial(n - i) - n * Math.LN2);
  }
  return Math.min(1, sum);
}

/**
 * McNemar 검정을 **정확검정(exact binomial)** 으로 푼다.
 *
 * 카이제곱 근사를 쓰지 않는 이유는 표본이 작아서다. 케이스 12건 × 반복 3회면 불일치 쌍이
 * 한 자리 수로 나오는 일이 흔하고, 그 구간에서 근사는 p 를 낙관적으로 낸다. 낙관적인 p 는
 * 없는 개선을 있다고 말하게 만든다.
 *
 * 일치 쌍(둘 다 통과 / 둘 다 실패)은 검정에 들어가지 않는다. 두 구성이 똑같이 행동한
 * 케이스는 어느 쪽이 나은지에 대해 아무 정보가 없기 때문이다.
 */
export function mcnemarExact(pairs: PairedObservation[]): McNemarResult {
  const bOnlyFail = pairs.filter((p) => p.a && !p.b).length;
  const aOnlyFail = pairs.filter((p) => !p.a && p.b).length;
  const n = bOnlyFail + aOnlyFail;
  if (n === 0) return { bOnlyFail, aOnlyFail, discordant: 0, pValue: 1 };
  const k = Math.min(bOnlyFail, aOnlyFail);
  return {
    bOnlyFail,
    aOnlyFail,
    discordant: n,
    pValue: Math.min(1, 2 * binomialTailAtMost(k, n)),
  };
}

// ---------------------------------------------------------------------------
// 부트스트랩 신뢰구간
// ---------------------------------------------------------------------------

export interface DiffCi {
  /** B 통과율 - A 통과율. */
  estimate: number;
  low: number;
  high: number;
  iterations: number;
  seed: number;
}

/**
 * 통과율 차이의 95% 구간을 **케이스 단위 재표집**으로 낸다.
 *
 * 실행 하나하나를 재표집하지 않는 이유: 같은 케이스의 반복 실행은 독립이 아니다. 어려운
 * 케이스는 세 번 다 실패하기 쉽다. 실행 단위로 뽑으면 표본이 실제보다 많은 척하게 되고
 * 구간이 좁아진다 - 좁은 구간은 곧 없는 유의성이다.
 */
export function bootstrapDiffCi(
  pairs: PairedObservation[],
  seed = 20260811,
  iterations = 2000,
): DiffCi {
  const byCase = new Map<string, PairedObservation[]>();
  for (const p of pairs) {
    const list = byCase.get(p.caseId) ?? [];
    list.push(p);
    byCase.set(p.caseId, list);
  }
  const groups = [...byCase.values()];
  const rate = (obs: PairedObservation[], side: 'a' | 'b') =>
    obs.length === 0 ? 0 : obs.filter((o) => o[side]).length / obs.length;
  const estimate = rate(pairs, 'b') - rate(pairs, 'a');

  if (groups.length === 0) return { estimate: 0, low: 0, high: 0, iterations, seed };

  const rng = seededRng(seed);
  const diffs: number[] = [];
  for (let i = 0; i < iterations; i += 1) {
    const sample: PairedObservation[] = [];
    for (let g = 0; g < groups.length; g += 1) {
      sample.push(...groups[Math.floor(rng() * groups.length)]!);
    }
    diffs.push(rate(sample, 'b') - rate(sample, 'a'));
  }
  diffs.sort((x, y) => x - y);
  const at = (q: number) => diffs[Math.min(diffs.length - 1, Math.floor(q * diffs.length))]!;
  return { estimate, low: at(0.025), high: at(0.975), iterations, seed };
}

// ---------------------------------------------------------------------------
// 검정력 - 이 규모가 못 보는 것
// ---------------------------------------------------------------------------

export interface Power {
  /** 유의에 도달하려면 한쪽으로 몰려야 하는 최소 불일치 쌍 수. */
  minDiscordant: number;
  /** 그 수를 전체 쌍 수로 나눈 값. 이보다 작은 차이는 이 규모로 못 본다. */
  minDetectableDiff: number;
  totalPairs: number;
}

/**
 * 이 표본 크기가 **잡을 수 있는 가장 작은 차이**를 낸다.
 *
 * 수치를 내는 화면은 많지만 그 수치가 못 보는 것을 적는 화면은 드물다. 유의하지 않다는
 * 결과를 "차이가 없다"로 읽는 사고가 여기서 갈린다 - 차이가 없는 것과 이 규모로는 못 보는
 * 것은 다르다.
 *
 * 계산은 정확검정을 거꾸로 돌린 것이다. 불일치 쌍이 전부 한쪽으로 몰렸다고 가정할 때
 * 양측 p 가 0.05 아래로 내려가는 최소 개수를 찾는다(k=6 에서 2 x 0.5^6 = 0.031).
 */
export function power(totalPairs: number, alpha = 0.05): Power {
  let k = 1;
  while (k <= 64 && 2 * Math.pow(0.5, k) > alpha) k += 1;
  return {
    minDiscordant: k,
    minDetectableDiff: totalPairs === 0 ? 1 : k / totalPairs,
    totalPairs,
  };
}

// ---------------------------------------------------------------------------
// 판정
// ---------------------------------------------------------------------------

export type Verdict = 'signal' | 'noise' | 'insufficient';

export const VERDICT_LABEL: Record<Verdict, string> = {
  signal: '차이가 잡음보다 큽니다',
  noise: '이 차이는 잡음과 구분되지 않습니다',
  insufficient: '표본이 모자라 판정할 수 없습니다',
};

/**
 * 결론 문구를 셋으로 고정한다. 세 번째가 있어야 정직하다 - 표본이 부족한 상태를
 * "차이 없음"으로 접으면, 아무것도 재지 못한 실험이 안정적인 실험처럼 보인다.
 *
 * 두 근거(정확검정 p, 부트스트랩 구간)가 어긋나면 보수적으로 잡음이라고 말한다. 하나만
 * 신호를 가리킬 때 신호라고 부르면, 두 방법을 쓴 이유가 사라진다.
 */
export function verdictOf(m: McNemarResult, ci: DiffCi, p: Power): Verdict {
  if (m.discordant < p.minDiscordant) return 'insufficient';
  const ciExcludesZero = (ci.low > 0 && ci.high > 0) || (ci.low < 0 && ci.high < 0);
  return m.pValue < 0.05 && ciExcludesZero ? 'signal' : 'noise';
}

// ---------------------------------------------------------------------------
// 자기 분산 - B 를 보기 전에 먼저 봐야 하는 것
// ---------------------------------------------------------------------------

export interface SelfSpread {
  variantId: string;
  /** 회차별 통과율. */
  perRun: { runIndex: number; rate: number }[];
  low: number;
  high: number;
}

/**
 * 한 구성이 **자기 자신과** 얼마나 흔들리는지. 화면에서 이것을 먼저 보여준다.
 *
 * 구성 A 가 회차마다 62%~71% 사이에서 흔들린다는 것을 먼저 보면, B 가 68% 라는 사실이
 * 그 자체로는 아무 말도 하지 않는다는 것을 누구나 안다. 대부분의 평가 화면이 이 줄을
 * 빼먹고 두 막대를 나란히 세운다.
 */
export function selfSpread(
  scores: { variantId: string; runIndex: number; passed: boolean }[],
  variantId: string,
): SelfSpread {
  const mine = scores.filter((s) => s.variantId === variantId);
  const runs = [...new Set(mine.map((s) => s.runIndex))].sort((a, b) => a - b);
  const perRun = runs.map((runIndex) => {
    const at = mine.filter((s) => s.runIndex === runIndex);
    return { runIndex, rate: at.length === 0 ? 0 : at.filter((s) => s.passed).length / at.length };
  });
  const rates = perRun.map((r) => r.rate);
  return {
    variantId,
    perRun,
    low: rates.length ? Math.min(...rates) : 0,
    high: rates.length ? Math.max(...rates) : 0,
  };
}

/** 두 구성의 자기 분산 구간이 겹치는지. 겹치면 평균 차이는 눈으로도 의미가 없다. */
export function spreadsOverlap(x: SelfSpread, y: SelfSpread): boolean {
  return x.low <= y.high && y.low <= x.high;
}

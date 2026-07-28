// 결정적 의사난수(mulberry32) - 시드 하나로 동일 시퀀스를 재현한다.
// 목적: 목업 시세 스트림과 테스트를 "재현 가능"하게 만든다. Math.random 은 매 로드마다
// 달라 스냅샷 테스트/버그 재현이 불가능하지만, 시드 기반이면 같은 시드는 항상 같은 흐름을
// 낸다(§0 목업 - 실서비스 데이터와 무관). 주기 2^32, 통계 품질은 UI 목업엔 충분하다.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 문자열(마켓 심볼 등)을 32bit 시드로 - 같은 심볼은 항상 같은 시드.
export function hashSeed(input: string): number {
  let h = 2166136261 >>> 0; // FNV-1a
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

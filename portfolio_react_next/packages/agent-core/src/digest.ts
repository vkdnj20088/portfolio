/**
 * 안정 다이제스트 - 도구 입출력과 도구 집합의 동일성 판정에 쓴다.
 *
 * 왜 직접 구현하는가: 이 값은 **동일성 비교에만** 쓰이지 보안 용도가 아니다(서명도 아니고
 * 비밀도 아니다). Node 의 crypto 를 쓰면 브라우저 번들에서 갈리고, Web Crypto 는 비동기라
 * 순수 비교 함수가 async 로 오염된다. FNV-1a 64bit 두 벌이면 이 용도에는 충분하고,
 * 런타임 외부 패키지도 늘지 않는다.
 *
 * 안정성이 핵심이다 - 키 순서가 달라도 같은 값이 나와야 한다. JSON.stringify 는 삽입 순서를
 * 따르므로 그대로 쓰면 "내용은 같은데 다이제스트가 다른" 오탐이 난다.
 */

/** 키를 정렬해 직렬화한다. 배열 순서는 의미가 있으므로 보존한다. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

/** FNV-1a 32bit 한 라운드. 시드를 바꿔 두 벌 돌리면 충돌 확률이 실용상 충분히 낮아진다. */
function fnv1a(input: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    // FNV prime 16777619 곱셈을 32bit 로 유지한다(Math.imul 이 오버플로를 잘라 준다).
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** 16자 소문자 hex. 짧지만 이 용도(동일성 비교)에는 충분하고 화면에 그대로 보이기에도 적당하다. */
export function digest(value: unknown): string {
  const s = stableStringify(value);
  const a = fnv1a(s, 0x811c9dc5);
  const b = fnv1a(s, 0x01000193);
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

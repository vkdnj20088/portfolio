import { digest } from './digest';

/**
 * traceId / spanId 생성.
 *
 * traceId 는 그대로 Spring 의 `X-Request-Id` 헤더로 나간다. 그쪽 `CorrelationIdFilter` 는
 * **`[A-Za-z0-9-]` 1~64자만** 통과시키고 위반하면 헤더를 버린 뒤 자기 UUID 를 만든다 -
 * 그러면 span 과 서버 로그가 서로 다른 ID 를 갖게 되어 이 데모의 연결 고리가 조용히 끊긴다.
 * 그래서 32자 소문자 hex 로 고정한다(OTel trace id 와 같은 폭이고, 필터 제약도 만족한다).
 */
const HEX = '0123456789abcdef';

/** Spring CorrelationIdFilter 가 받아 주는 형식인가. 테스트가 이 함수를 직접 본다. */
export function isCorrelationSafe(id: string): boolean {
  return id.length >= 1 && id.length <= 64 && /^[A-Za-z0-9-]+$/.test(id);
}

/**
 * 결정적 id 생성기. 수집 실행에서도 시드로 만든다 - 그래야 커밋된 trace 의 id 가
 * 재수집 때 요동치지 않아 diff 가 읽힌다.
 */
export function createIdFactory(seed: string) {
  let counter = 0;
  return {
    traceId(): string {
      return expand(digest([seed, 'trace', counter++]), 32);
    },
    spanId(): string {
      return expand(digest([seed, 'span', counter++]), 16);
    },
  };
}

function expand(seedHex: string, length: number): string {
  let out = seedHex;
  let round = 0;
  while (out.length < length) {
    out += digest([seedHex, round++]);
  }
  // digest 는 hex 만 내지만, 길이를 맞추면서 형식이 깨지지 않는지 한 번 더 못박는다.
  return out
    .slice(0, length)
    .split('')
    .map((c) => (HEX.includes(c) ? c : '0'))
    .join('');
}

/*
 * 가변 높이 리스트 가상화의 핵심 순수 계산(#Q1) - 거래소의 고정 높이 windowing 을 일반화한 것.
 *
 * 고정 높이는 index = floor(scrollTop / rowH) 한 번이면 되지만, 채팅 말풍선은 길이/코드블럭/
 * 이미지로 높이가 제각각이라 그 지름길이 없다. 대신 "각 항목의 바닥 위치(누적 높이)" 배열을 두고
 * 이진탐색으로 가시 구간을 O(log n) 에 찾는다. 순수 함수라 경계(빈 목록/맨 위/아래/오버스캔)를
 * DOM 없이 단위 테스트로 못박을 수 있다.
 *
 * 이 코어는 "windowing 을 조직 자산으로" 추출한 조각이다. MessageList 에 실제로 배선하려면
 * 높이 측정 캐시(ResizeObserver)/스크롤 앵커링 재검증(prepend 시 기준 위치 불변)/스트리밍 팔로우/
 * reduced-motion 을 함께 다뤄야 하며, 그 통합은 e2e 재검증을 동반한 별도 게이트다(README 참고).
 */
export interface VarWindowInput {
  scrollTop: number;
  viewportH: number;
  /** offsets[i] = i번째 항목의 바닥 위치(항목 0..i 높이 누적). 오름차순, 길이 = 항목 수. */
  offsets: number[];
  /** 가시 구간 위/아래로 더 그릴 여유 항목 수(스크롤 시 흰 줄 방지). */
  overscan: number;
}

export interface VarWindowOut {
  start: number; // 렌더 시작 인덱스(포함)
  end: number; // 렌더 끝 인덱스(제외)
  padTop: number; // 위 스페이서 높이(px) = 앞 항목들의 누적 높이
  padBottom: number; // 아래 스페이서 높이(px)
}

export function computeVariableWindow({
  scrollTop,
  viewportH,
  offsets,
  overscan,
}: VarWindowInput): VarWindowOut {
  const n = offsets.length;
  if (n === 0) return { start: 0, end: 0, padTop: 0, padBottom: 0 };
  const total = offsets[n - 1]!; // n>=1 보장
  const top = Math.max(0, Math.min(scrollTop, Math.max(0, total - viewportH)));

  // 첫 가시 항목 = 바닥이 top 보다 아래(offsets[i] > top)인 최소 i.
  const first = upperBoundIndex(offsets, top);
  // 마지막 가시 항목 = 바닥이 (top+viewportH) 보다 아래인 최소 i.
  const lastVisible = upperBoundIndex(offsets, top + viewportH);

  const start = Math.max(0, first - overscan);
  const end = Math.min(n, lastVisible + 1 + overscan); // n>=1, lastVisible>=0 -> end>=1
  const padTop = start === 0 ? 0 : offsets[start - 1]!;
  const padBottom = total - offsets[end - 1]!;
  return { start, end, padTop, padBottom };
}

/** offsets[i] > value 인 최소 i(이진탐색). 없으면 n. */
function upperBoundIndex(offsets: number[], value: number): number {
  let lo = 0;
  let hi = offsets.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid]! > value)
      hi = mid; // mid < hi <= length -> 정의됨
    else lo = mid + 1;
  }
  return lo;
}

/** 항목 높이 배열 -> 누적 바닥 오프셋 배열(측정/추정 높이에서 offsets 를 만드는 헬퍼). */
export function toOffsets(heights: number[]): number[] {
  const out = new Array<number>(heights.length);
  let acc = 0;
  for (let i = 0; i < heights.length; i++) {
    acc += heights[i]!;
    out[i] = acc;
  }
  return out;
}

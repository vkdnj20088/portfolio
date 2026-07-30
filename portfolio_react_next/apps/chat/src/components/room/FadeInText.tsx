'use client';

import { useMemo, useRef } from 'react';
import styles from './FadeInText.module.css';

/** 조각 간 스태거 간격(ms). 페이드 지속시간은 CSS(.piece)가 소유한다. */
const STAGGER_MS = 40;

/**
 * 응답 텍스트를 어절 단위로 잘라 순차 페이드 인한다(5단계).
 *
 * 분절 - Intl.Segmenter(word). 공백 split 보다 견고하다: 공백 없는 CJK 구간도
 * 어절로 나뉘고 문장부호가 앞 어절에 자연스럽게 붙는다. 런타임 하한은
 * Chrome 87+/Node 16+ 로 지원 창(88) 안이며, 타입은 lib 의 ES2022.Intl 이 공급한다.
 * 공백 세그먼트는 앞 조각에 합쳐 스태거 슬롯을 차지하지 않게 한다(보이지 않는
 * 조각이 시간을 쓰면 체감 속도만 느려진다).
 *
 * 지연 배정 - "그 조각이 처음 나타난 배치" 기준으로 계산해 ref 에 고정한다.
 *  - 지금 mock 은 전체 텍스트가 한 번에 오므로 배치가 하나다(처음부터 끝까지 스태거).
 *  - 추후 delta 스트리밍으로 text 가 자라나면, 새로 도착한 조각들만 0부터 스태거를
 *    다시 세며 이어 붙는다. 소비 측은 text prop 만 갱신하면 된다.
 *  - 한 번 배정한 지연은 바꾸지 않는다: animation-delay 변경은 이미 끝난 CSS
 *    애니메이션의 타임라인을 다시 계산시켜 재생이 튈 수 있다.
 *
 * prefers-reduced-motion - 즉시 표시로 강등한다. 토큰의 전역 규칙은 duration 만
 * 0 으로 만들 뿐 delay 는 남아 "순차 등장" 자체가 유지되므로, 전역 규칙에 맡기지
 * 않고 여기서 애니메이션 경로를 명시적으로 끈다.
 */
export function FadeInText({ text }: { text: string }) {
  const pieces = useMemo(() => splitPieces(text), [text]);

  /* 조각별 지연(ms) - 처음 본 조각에만 배정, 이후 렌더에서 불변. */
  const delaysRef = useRef<number[]>([]);
  const delays = delaysRef.current;
  if (delays.length < pieces.length) {
    const batchStart = delays.length; // 이번 배치의 첫 조각은 지연 0부터 다시 센다
    for (let i = batchStart; i < pieces.length; i++) {
      delays[i] = (i - batchStart) * STAGGER_MS;
    }
  }

  if (prefersReducedMotion()) {
    return <>{text}</>;
  }

  return (
    <>
      {pieces.map((piece, index) => (
        <span
          key={index}
          className={styles.piece}
          style={{ animationDelay: `${delays[index] ?? 0}ms` }}
        >
          {piece}
        </span>
      ))}
    </>
  );
}

/* Segmenter 는 생성 비용이 있어 모듈에서 한 번만 만든다. */
let segmenter: Intl.Segmenter | null = null;

function splitPieces(text: string): string[] {
  segmenter ??= new Intl.Segmenter('ko', { granularity: 'word' });
  const pieces: string[] = [];
  for (const { segment, isWordLike } of segmenter.segment(text)) {
    const last = pieces.length - 1;
    // 공백/문장부호는 앞 조각에 붙인다 - 스태거는 보이는 어절 단위로만 진행된다.
    if (!isWordLike && last >= 0) pieces[last] += segment;
    else pieces.push(segment);
  }
  return pieces;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

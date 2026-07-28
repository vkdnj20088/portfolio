import { Fragment, type ReactNode } from 'react';
import { splitByTerms } from '@chat/ui';

/** 문단 원문에서 근거 구간 [start, end) 만 하이라이트(MRC span). 값은 코퍼스에서 온 것이라 안전. */
export function SpanHighlight({
  text,
  start,
  end,
}: {
  text: string;
  start: number;
  end: number;
}): ReactNode {
  if (start < 0 || end <= start || end > text.length) return text;
  return (
    <>
      {text.slice(0, start)}
      <mark className="hl">{text.slice(start, end)}</mark>
      {text.slice(end)}
    </>
  );
}

/**
 * 매칭된 질의어/확장어 출현부를 하이라이트(검색 결과용).
 * 조각내기(이스케이프·긴 항목 우선·경계)는 두 앱이 공유하는 @chat/ui 로 뽑고, 여기서는 그리기만 한다.
 */
export function TermHighlight({ text, terms }: { text: string; terms: string[] }): ReactNode {
  const segments = splitByTerms(text, terms);
  return (
    <>
      {segments.map((segment, i) =>
        segment.match ? (
          <mark key={i} className="hl">
            {segment.text}
          </mark>
        ) : (
          <Fragment key={i}>{segment.text}</Fragment>
        ),
      )}
    </>
  );
}

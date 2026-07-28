import type { Answer } from './types';

/**
 * 근거 검증(§0의 런타임 증명). "추출형이라 환각이 없다"는 주장을 말로 두지 않고, 실제로 답변 문자열이
 * 인용 문단의 [spanStart, spanEnd) 구간과 축자(verbatim) 일치하는지 매 응답마다 대조한다.
 * 화면의 관측 배지가 이 결과를 그대로 노출하므로, 만약 생성형으로 바꿔 한 글자라도 지어내면 즉시 실패로 보인다.
 */
export interface GroundingReport {
  /** 답변이 인용 문단의 그 구간과 문자 단위로 같은가(= 지어낸 말이 0). */
  verbatim: boolean;
  /** 인용(문서 출처)이 붙어 있는가. */
  cited: boolean;
  /** 근거 span 이 문단에서 차지하는 비율(0~1). 낮을수록 문단을 통째로 던지지 않고 좁게 특정했다는 뜻. */
  spanRatio: number;
}

const EMPTY: GroundingReport = { verbatim: false, cited: false, spanRatio: 0 };

export function verifyGrounding(answer: Answer | null): GroundingReport {
  if (!answer) return EMPTY;
  const { passageText, spanStart, spanEnd, text } = answer;
  const inRange = spanStart >= 0 && spanEnd <= passageText.length && spanStart < spanEnd;
  const verbatim = inRange && passageText.slice(spanStart, spanEnd) === text;
  return {
    verbatim,
    cited: answer.docId.length > 0 && answer.docTitle.length > 0,
    spanRatio: passageText.length === 0 ? 0 : Math.min(1, text.length / passageText.length),
  };
}

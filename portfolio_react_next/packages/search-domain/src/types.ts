/**
 * JC DocuQA 도메인 타입. 두 제품 표면(시맨틱 검색 · 근거 QA)이 공유하는 코퍼스/검색/독해 계약.
 *
 * §0: 실 LLM/벡터DB 없음. 코퍼스는 가상 JC 사내문서 더미(한국어 픽션), 검색은 결정적(TF-IDF+동의어),
 * 답변은 코퍼스에서 "추출"(생성 아님)이라 구조적으로 환각이 없다. 이게 곧 42Maru 신뢰성 서사의 재현.
 */

/** 문서 안의 한 문단(검색·인용의 최소 단위). */
export interface Passage {
  id: string;
  docId: string;
  /** 원문 문단. 답변 하이라이트는 이 문자열의 [spanStart, spanEnd) 구간으로 가리킨다. */
  text: string;
}

/** 가상 사내문서 한 건. */
export interface Doc {
  id: string;
  title: string;
  /** HR정책 · 제품매뉴얼 · 보안정책 · FAQ · 인프라 등. */
  category: string;
  passages: Passage[];
}

/** 검색 결과 한 건 - 시맨틱 점수와 키워드 점수를 함께 담아 "키워드 vs 시맨틱" 비교를 가능하게 한다. */
export interface ScoredPassage {
  passage: Passage;
  docTitle: string;
  category: string;
  /** 시맨틱 점수(동의어 확장 TF-IDF 코사인, 0~1). */
  semantic: number;
  /** 키워드 점수(동의어 확장 없이 질의어 그대로 매긴 같은 TF-IDF 코사인, 0~1). */
  keyword: number;
  /** 이 문단에서 실제로 매칭된 질의어/확장어(하이라이트·설명용). */
  matched: string[];
}

/** 추출형 답변 - 코퍼스 문단에서 그대로 오려낸 근거 구간. 생성이 아니므로 항상 출처가 있다. */
export interface Answer {
  /** 근거 구간 텍스트(passage.text 의 [spanStart, spanEnd)와 동일). */
  text: string;
  passageId: string;
  docId: string;
  docTitle: string;
  category: string;
  /** 근거가 속한 문단 전문(하이라이트 렌더용). */
  passageText: string;
  spanStart: number;
  spanEnd: number;
  /** 근거 신뢰도(질의-근거 의미 겹침 기반, 0~1). 임계 미만이면 answer=null 로 "정답 없음"을 정직하게 반환. */
  confidence: number;
}

/** 스트리밍 답변 이벤트 - 챗의 ReplyEvent 와 같은 형태(delta 누적 후 done). 전송계층 교체 seam 공유. */
export type AnswerEvent = { type: 'delta'; text: string } | { type: 'done'; answer: Answer | null };

export type SearchMode = 'semantic' | 'keyword';

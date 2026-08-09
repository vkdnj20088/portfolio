import samples from './llm-samples.json';

/**
 * 커밋된 **실제 LLM 응답** 재생.
 *
 * 배포에는 API 키를 두지 않는다(§0). 그러면 "전송 계층만 바꾸면 실제 LLM 이 답한다"는 이
 * 데모의 주장이 배포에서는 확인할 길이 없다 - 코드는 실재하는데 화면은 늘 목업이다.
 * 그래서 키를 가진 사람이 한 번 받아 온 응답을 질문별로 커밋해 두고, 무키 서버가 그것을
 * 그대로 재생한다. loandoc 의 LLM 캐시와 같은 원리다(요청 -> 응답을 산출물로 굳힌다).
 *
 * 경계는 화면이 직접 말한다: 추천 질문은 실제 LLM 응답 재생, 그 밖의 입력은 결정적 목업.
 * 재생을 실시간 호출인 척하지 않는 것이 이 장치의 전제다.
 *
 * 매칭이 정규화된 질문 문자열인 이유: 추천 칩이 보내는 문장은 고정이라 이것으로 충분하고,
 * 임베딩 같은 근사 매칭을 넣으면 "무엇이 재생이고 무엇이 목업인지" 경계가 흐려진다.
 */
export interface LlmSample {
  /** 질문 원문(추천 칩 문구와 같다). */
  question: string;
  /** 그 질문에 실제 LLM 이 낸 응답. */
  reply: string;
  /** 생성에 쓴 모델 - 언제 무엇으로 만든 답인지 남긴다. */
  model: string;
  /** 생성 시각(ISO). 오래된 답을 갱신할 판단 근거. */
  generatedAt: string;
}

const BY_QUESTION = new Map<string, LlmSample>(
  (samples as LlmSample[]).map((s) => [normalize(s.question), s]),
);

/** 공백·대소문자만 정규화한다. 그 이상 손대면 우연한 매칭이 생긴다. */
function normalize(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** 이 질문에 커밋된 실제 LLM 응답이 있으면 돌려준다. */
export function findLlmSample(question: string): LlmSample | undefined {
  return BY_QUESTION.get(normalize(question));
}

/** 재생할 응답이 하나라도 있는가 - 화면 문구(모드 표기)의 근거. */
export function hasLlmSamples(): boolean {
  return BY_QUESTION.size > 0;
}

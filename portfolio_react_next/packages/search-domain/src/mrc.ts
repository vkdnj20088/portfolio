import {
  expansionsOf,
  idfOf,
  search,
  tokenize,
  tokenizeQuery,
  type FollowUpContext,
} from './retrieval';
import type { Answer } from './types';

/**
 * 기계독해(MRC) 흉내 - 상위 문단에서 질의에 가장 맞는 "문장 구간"을 그대로 오려내 답으로 삼는다.
 * 생성이 아니라 추출이므로 코퍼스에 없는 말은 절대 만들지 않는다. 근거가 약하면 null 을 돌려
 * "정답 없음"을 정직하게 표현한다 - 42Maru 의 "단 하나의 정답 / 신뢰성" 서사 재현.
 *
 * 불응답(abstain)이 이 모듈의 핵심 책임이다. 단순 토큰 겹침 비율로 채점하면 "수/것/때" 같은 흔한 말
 * 하나만 걸려도 임계를 넘겨, 코퍼스에 없는 질문(주차장 운영시간 등)에도 엉뚱한 문장을 자신 있게 내민다.
 * 그래서 두 겹으로 막는다: (1) 검색 점수 하한 - 애초에 관련 문단이 없으면 읽지 않는다,
 * (2) IDF 가중 채점 - 흔한 말은 거의 점수를 주지 않고 희소어가 겹칠 때만 확신한다.
 */

interface Sentence {
  text: string;
  start: number;
  end: number;
}

/**
 * 문장 경계로 분할하되 문단 내 위치를 함께 돌려준다("1.5배" 처럼 뒤에 공백이 없는 소수점은 안 나뉜다).
 * 위치를 따로 indexOf 로 찾으면 같은 문장이 두 번 나오는 문단에서 첫 번째를 가리켜 하이라이트가 어긋난다.
 */
function splitSentences(text: string): Sentence[] {
  const out: Sentence[] = [];
  let cursor = 0;
  for (const raw of text.split(/(?<=\.)\s+/)) {
    const at = text.indexOf(raw, cursor); // 순차 스캔 - 중복 문장도 제 위치를 잡는다
    if (at < 0) continue;
    cursor = at + raw.length;
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    const start = at + raw.indexOf(trimmed);
    out.push({ text: trimmed, start, end: start + trimmed.length });
  }
  return out;
}

/**
 * 문장 점수 = (문장이 맞힌 질의어의 IDF 합) / (질의어 IDF 총합). 0~1, 결정적.
 * 동의어로 맞힌 것은 절반만 인정한다("정확히 물은 말"이 우선).
 * IDF 가중이라 "수/것/때/있습니다" 같은 흔한 말은 맞혀도 점수가 거의 오르지 않는다 - 불용어 목록을
 * 손으로 관리하지 않고 코퍼스 통계가 스스로 정하게 두는 쪽을 택했다.
 */
function scoreSentence(queryTerms: string[], sentence: string): number {
  const sTokens = new Set(tokenize(sentence));
  let hit = 0;
  let total = 0;
  for (const q of queryTerms) {
    const weight = idfOf(q);
    total += weight;
    if (sTokens.has(q)) hit += weight;
    else if (expansionsOf(q).some((syn) => sTokens.has(syn))) hit += weight * 0.5;
  }
  return total === 0 ? 0 : hit / total;
}

/** 근거 채택 하한. 이 밑이면 "정답 없음"(불응답). 평가 하니스(eval)로 보정한 값이다. */
export const CONFIDENCE_THRESHOLD = 0.29;
/** 검색 점수 하한. 관련 문단 자체가 없으면 읽지도 않는다(불응답의 1차 방어선). */
export const RETRIEVAL_FLOOR = 0.05;
/** 독해 대상 문단 수(리트리벌 -> 리랭크 -> 독해 파이프라인의 마지막 단계 폭). */
export const MRC_TOP_K = 3;

/** 질의에 대한 추출형 답변. 근거가 약하면 null(정답 없음). */
export function extractAnswer(query: string, ctx?: FollowUpContext): Answer | null {
  const qTokens = tokenizeQuery(query);
  if (qTokens.length === 0) return null;
  const top = search(query, 'semantic', MRC_TOP_K, ctx);
  const best0 = top[0];
  if (!best0 || best0.semantic < RETRIEVAL_FLOOR) return null;

  let best: { sentence: Sentence; score: number; passageId: string } | null = null;
  for (const r of top) {
    for (const sentence of splitSentences(r.passage.text)) {
      const s = scoreSentence(qTokens, sentence.text);
      if (!best || s > best.score) best = { sentence, score: s, passageId: r.passage.id };
    }
  }
  if (!best || best.score < CONFIDENCE_THRESHOLD) return null;

  const found = best;
  const passage = top.find((r) => r.passage.id === found.passageId);
  if (!passage) return null;
  return {
    text: found.sentence.text,
    passageId: passage.passage.id,
    docId: passage.passage.docId,
    docTitle: passage.docTitle,
    category: passage.category,
    passageText: passage.passage.text,
    spanStart: found.sentence.start,
    spanEnd: found.sentence.end,
    confidence: Math.min(1, Math.round(found.score * 100) / 100),
  };
}

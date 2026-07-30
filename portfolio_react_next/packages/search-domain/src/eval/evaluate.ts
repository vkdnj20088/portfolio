import { extractAnswer } from '../mrc';
import { search } from '../retrieval';
import type { SearchMode } from '../types';
import { GOLDSET, type EvalCase } from './goldset';

/**
 * 평가 하니스. "시맨틱이 키워드보다 낫다"거나 "환각이 없다" 같은 주장을 화면 문구가 아니라
 * 숫자로 지탱하기 위한 도구다. 엔진이 결정적이라 같은 코드는 늘 같은 표를 낸다 - 회귀 게이트로 쓸 수 있다.
 *
 * 보는 것:
 *  - 검색 품질: Recall@1/3/5, MRR (시맨틱 vs 키워드를 같은 골드셋으로 대조)
 *  - 독해 품질: 답한 것 중 근거 문단이 정답인 비율
 *  - 불응답 품질: 답이 없어야 할 때 실제로 침묵했는가 / 답이 있는데 과하게 침묵하지 않았는가
 */
export interface RetrievalScore {
  n: number;
  recall1: number;
  recall3: number;
  recall5: number;
  mrr: number;
}

export interface AnswerScore {
  /** 답이 있어야 하는 문항 수. */
  n: number;
  /** 그중 실제로 답한 수. */
  answered: number;
  /** 답한 것 중 근거 문단이 골드와 일치한 수. */
  correct: number;
  /** correct / n - 침묵도 실패로 세는 엄격한 정확도. */
  accuracy: number;
}

export interface AbstentionScore {
  /** 답이 없어야 하는 문항 수. */
  n: number;
  /** 그중 실제로 침묵한 수. */
  abstained: number;
  /** abstained / n - 지어내지 않은 비율. */
  rate: number;
  /** 답이 있는 문항인데 침묵한 수(과잉 불응답). */
  overAbstained: number;
}

export interface EvalReport {
  cases: number;
  retrieval: Record<SearchMode, RetrievalScore>;
  answer: AnswerScore;
  abstention: AbstentionScore;
  /** 문항별 상세(화면 표·디버깅용). */
  rows: EvalRow[];
}

export interface EvalRow {
  q: string;
  split: EvalCase['split'];
  gold: string | null;
  /** 시맨틱 검색에서 골드 문단의 순위(1-base, 없으면 null). */
  semanticRank: number | null;
  /** 키워드 검색에서 골드 문단의 순위. */
  keywordRank: number | null;
  /** 실제 추출된 답의 근거 문단(침묵이면 null). */
  answered: string | null;
  ok: boolean;
}

const DEPTH = 5;

function rankOf(query: string, mode: SearchMode, gold: string): number | null {
  const results = search(query, mode, DEPTH);
  for (let i = 0; i < results.length; i++) {
    if (results[i]?.passage.id === gold) return i + 1;
  }
  return null;
}

function summarize(ranks: (number | null)[]): RetrievalScore {
  const n = ranks.length;
  const within = (k: number) => ranks.filter((r) => r !== null && r <= k).length / (n || 1);
  const mrr = ranks.reduce<number>((sum, r) => sum + (r === null ? 0 : 1 / r), 0) / (n || 1);
  return {
    n,
    recall1: round(within(1)),
    recall3: round(within(3)),
    recall5: round(within(5)),
    mrr: round(mrr),
  };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function evaluate(cases: EvalCase[] = GOLDSET): EvalReport {
  const rows: EvalRow[] = [];
  const semanticRanks: (number | null)[] = [];
  const keywordRanks: (number | null)[] = [];

  let answerableN = 0;
  let answered = 0;
  let correct = 0;
  let unanswerableN = 0;
  let abstained = 0;
  let overAbstained = 0;

  for (const c of cases) {
    const result = extractAnswer(c.q);
    const answeredId = result ? result.passageId : null;

    if (c.gold === null) {
      unanswerableN += 1;
      if (answeredId === null) abstained += 1;
      rows.push({
        q: c.q,
        split: c.split,
        gold: null,
        semanticRank: null,
        keywordRank: null,
        answered: answeredId,
        ok: answeredId === null,
      });
      continue;
    }

    answerableN += 1;
    const semanticRank = rankOf(c.q, 'semantic', c.gold);
    const keywordRank = rankOf(c.q, 'keyword', c.gold);
    semanticRanks.push(semanticRank);
    keywordRanks.push(keywordRank);
    if (answeredId === null) overAbstained += 1;
    else answered += 1;
    const ok = answeredId === c.gold;
    if (ok) correct += 1;
    rows.push({
      q: c.q,
      split: c.split,
      gold: c.gold,
      semanticRank,
      keywordRank,
      answered: answeredId,
      ok,
    });
  }

  return {
    cases: cases.length,
    retrieval: { semantic: summarize(semanticRanks), keyword: summarize(keywordRanks) },
    answer: {
      n: answerableN,
      answered,
      correct,
      accuracy: round(correct / (answerableN || 1)),
    },
    abstention: {
      n: unanswerableN,
      abstained,
      rate: round(abstained / (unanswerableN || 1)),
      overAbstained,
    },
    rows,
  };
}

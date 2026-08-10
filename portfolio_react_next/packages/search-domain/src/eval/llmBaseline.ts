import { search } from '../retrieval';
import type { SearchMode } from '../types';
import { evaluate, type EvalReport } from './evaluate';
import { GOLDSET, type EvalSplit } from './goldset';
import baseline from './llm-baseline.json';

/**
 * LLM 독해 베이스라인 - **대조군**이다.
 *
 * 이 데모의 주장은 "근거가 없으면 답하지 않는다"이고, 그 근거는 답변이 생성이 아니라 코퍼스에서의
 * 추출이라는 구조에 있다. 구조로 얻은 성질이라면 같은 문제를 생성 모델에 시켰을 때 무엇이
 * 달라지는지를 같은 골드셋으로 보여야 말이 선다. 그래서 이 표는 우열을 매기지 않는다 -
 * **무엇이 다른가**를 본다. LLM 이 더 맞힌 문항이 있으면 그것도 같은 표에 남는다.
 *
 * 대조 설계: **검색은 고정하고 읽기만 바꾼다.** 두 경로 모두 같은 질의로 같은 검색
 * (semantic, 상위 5건)을 돌린 뒤, 규칙 경로는 extractAnswer 로 근거 구간을 오려내고 LLM 경로는
 * 그 5건을 그대로 받아 "답이 있는 문단 id 하나 또는 없음"을 고른다. 이렇게 해야 차이가
 * 검색 품질이 아니라 독해·불응답 판단에서 온다고 말할 수 있다.
 *
 * 이 대조가 **재지 않는 것**: 검색 자체의 품질(양쪽이 같은 입력을 받는다), 자연어 답변의
 * 문장 품질(양쪽 다 근거 문단 id 로만 채점한다), 실시간 지연·비용.
 *
 * 무키 배포(§0): 런타임에 API 를 부르지 않는다. 키를 가진 사람이 한 번 수집해 커밋한
 * llm-baseline.json 을 화면이 재생할 뿐이다. 챗의 llm-samples.json, loandoc 의 판정 캐시와
 * 같은 장치이고 같은 정직성 경계를 쓴다 - 재생을 실시간 호출인 척하지 않는다.
 * 수집 절차는 apps/docqa/scripts/make-llm-baseline.ts 에 있다.
 */
export interface LlmBaselineCase {
  /** 골드셋 질문 원문. 매칭 키라 한 글자도 달라지면 안 된다. */
  q: string;
  /** LLM 이 고른 근거 문단 id. null 이면 "답 없음"으로 판단한 것(= 침묵). */
  answered: string | null;
  /** 모델 원문 응답. 채점은 answered 로 하지만, 판단을 사람이 되짚을 수 있게 남긴다. */
  raw: string;
  /**
   * 수집 시점에 후보로 준 문단 id 들. 코퍼스나 검색이 바뀌면 지금 계산과 달라지고,
   * 그러면 이 베이스라인은 "다른 문제를 푼 답"이 된다. 그 낡음을 화면과 테스트가
   * 감지할 수 있게 남긴다([staleCases]).
   */
  candidates: string[];
}

export interface LlmBaselineArtifact {
  /** 수집에 쓴 모델. 빈 문자열이면 아직 수집되지 않은 상태다. */
  model: string;
  /** 수집 시각(ISO). 코퍼스나 골드셋이 바뀌면 낡는다. */
  generatedAt: string;
  /** 후보를 뽑은 검색 모드 - 규칙 경로와 같아야 대조가 성립한다. */
  mode: SearchMode;
  /** 후보 개수(상위 N건). */
  depth: number;
  cases: LlmBaselineCase[];
}

/** 한 경로의 채점. 규칙과 LLM 을 같은 잣대로 재려고 두 쪽 모두 이 형태로 만든다. */
export interface SideScore {
  /** 답이 있어야 하는 문항 중 실제로 답한 수. */
  answered: number;
  /** 그중 근거 문단이 골드와 같은 수. */
  correct: number;
  /** 답이 있는데 틀린 근거를 댄 수 - 가장 나쁜 실패. */
  wrong: number;
  /** 답이 있는데 침묵한 수. */
  overAbstained: number;
  /** 답이 없어야 하는 문항 중 실제로 침묵한 수. */
  abstained: number;
  /** 답이 없는데 무언가를 답한 수 - 지어냄. */
  hallucinated: number;
}

export type Verdict = 'both' | 'ruleOnly' | 'llmOnly' | 'neither';

export interface LlmComparisonRow {
  q: string;
  split: EvalSplit;
  gold: string | null;
  ruleAnswered: string | null;
  llmAnswered: string | null;
  ruleOk: boolean;
  llmOk: boolean;
  verdict: Verdict;
}

export interface LlmComparison {
  model: string;
  generatedAt: string;
  mode: SearchMode;
  depth: number;
  /** 골드셋 문항 수. */
  cases: number;
  /** 그중 베이스라인이 커버한 문항 수. 부분 수집도 표시할 수 있게 나눠 둔다. */
  covered: number;
  rule: SideScore;
  llm: SideScore;
  rows: LlmComparisonRow[];
  /** 두 경로의 판정이 갈린 문항 수 - 이 표를 볼 이유 자체다. */
  disagreements: number;
}

const ARTIFACT = baseline as LlmBaselineArtifact;

/** 수집된 베이스라인이 있는가 - 화면이 "아직 수집 전" 상태를 정직하게 말하기 위한 근거. */
export function hasLlmBaseline(): boolean {
  return ARTIFACT.cases.length > 0;
}

export function llmBaselineArtifact(): LlmBaselineArtifact {
  return ARTIFACT;
}

/** 지금 검색이 이 질문에 주는 후보 문단 id 들. 수집 스크립트와 화면이 같은 함수를 쓴다. */
export function candidatesFor(
  q: string,
  mode: SearchMode = ARTIFACT.mode,
  depth: number = ARTIFACT.depth,
): string[] {
  return search(q, mode, depth).map((r) => r.passage.id);
}

/**
 * 수집 시점의 후보와 지금 후보가 달라진 질문들.
 *
 * 코퍼스 문단을 하나 고치거나 동의어를 더하면 후보가 바뀌는데, 그러면 커밋된 답은 지금과
 * **다른 문제를 푼 답**이 된다. 화면이 그것을 모른 채 나란히 놓으면 대조가 거짓이 되므로
 * 여기서 감지해 표에 밝힌다(테스트도 같은 함수를 본다).
 */
export function staleCases(): string[] {
  const stale: string[] = [];
  for (const c of ARTIFACT.cases) {
    const now = candidatesFor(c.q);
    if (now.length !== c.candidates.length || now.some((id, i) => id !== c.candidates[i])) {
      stale.push(c.q);
    }
  }
  return stale;
}

function emptyScore(): SideScore {
  return { answered: 0, correct: 0, wrong: 0, overAbstained: 0, abstained: 0, hallucinated: 0 };
}

function tally(score: SideScore, gold: string | null, answered: string | null): boolean {
  if (gold === null) {
    if (answered === null) {
      score.abstained += 1;
      return true;
    }
    score.hallucinated += 1;
    return false;
  }
  if (answered === null) {
    score.overAbstained += 1;
    return false;
  }
  score.answered += 1;
  if (answered === gold) {
    score.correct += 1;
    return true;
  }
  score.wrong += 1;
  return false;
}

function verdictOf(ruleOk: boolean, llmOk: boolean): Verdict {
  if (ruleOk && llmOk) return 'both';
  if (ruleOk) return 'ruleOnly';
  if (llmOk) return 'llmOnly';
  return 'neither';
}

/**
 * 규칙 경로와 LLM 베이스라인을 같은 골드셋으로 나란히 채점한다.
 *
 * 베이스라인이 일부 문항만 덮고 있어도(수집 중단·거절 등) 동작한다 - 덮인 문항만 대조하고
 * covered 로 그 사실을 드러낸다. 덮이지 않은 문항을 LLM 의 침묵으로 세면 없는 실패를
 * 만들어 내게 되므로 그렇게 하지 않는다.
 */
export function compareLlmBaseline(report: EvalReport = evaluate()): LlmComparison {
  const byQuestion = new Map(ARTIFACT.cases.map((c) => [c.q, c]));
  const ruleByQuestion = new Map(report.rows.map((r) => [r.q, r]));

  const rule = emptyScore();
  const llm = emptyScore();
  const rows: LlmComparisonRow[] = [];
  let disagreements = 0;

  for (const c of GOLDSET) {
    const sample = byQuestion.get(c.q);
    if (!sample) continue;
    const ruleRow = ruleByQuestion.get(c.q);
    if (!ruleRow) continue;

    const ruleOk = tally(rule, c.gold, ruleRow.answered);
    const llmOk = tally(llm, c.gold, sample.answered);
    if (ruleRow.answered !== sample.answered) disagreements += 1;

    rows.push({
      q: c.q,
      split: c.split,
      gold: c.gold,
      ruleAnswered: ruleRow.answered,
      llmAnswered: sample.answered,
      ruleOk,
      llmOk,
      verdict: verdictOf(ruleOk, llmOk),
    });
  }

  return {
    model: ARTIFACT.model,
    generatedAt: ARTIFACT.generatedAt,
    mode: ARTIFACT.mode,
    depth: ARTIFACT.depth,
    cases: GOLDSET.length,
    covered: rows.length,
    rule,
    llm,
    rows,
    disagreements,
  };
}

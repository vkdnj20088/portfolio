import type { BudgetSpent, RunState, SpanStatus } from '../types';

/**
 * 2단계 - 실행 **여럿**을 놓고 좋아졌는지 나빠졌는지 판정하는 층의 스키마.
 *
 * 1단계와 보는 단위가 다르다. 저쪽은 실행 하나를 되짚고, 이쪽은 구성 × 반복으로 흩어진
 * 실행 무리를 본다. 단위가 다르니 필요한 것도 다르다 - 저쪽은 span 트리, 이쪽은 표본과 통계다.
 *
 * DocuQA 의 `/eval` 과는 중복이 아니라 정반대다. 저쪽이 재는 것은 **같은 입력에 분산이 0인**
 * 규칙 엔진이라 골드셋과 임계값이면 충분하고, 값이 바뀌면 그대로 회귀다. 여기서 재는 것은
 * 모델 왕복이 낀 시스템이라 값이 바뀌어도 회귀가 아닐 수 있다. 그래서 반복과 통계가 필요하다.
 */

// ---------------------------------------------------------------------------
// 구성(variant) - A/B 의 축
// ---------------------------------------------------------------------------

/**
 * 비교할 구성 하나. **이름 있는 객체**로 둔 것이 요점이다.
 *
 * "프롬프트 A/B" 정도는 문자열 두 개로도 되지만, 3단계에서 비교하려는 축은 가드레일
 * 켬/끔이다. 그때 같은 A/B 자리에 들어오려면 구성이 지금부터 객체여야 한다. `guardrails`
 * 를 지금 빈 배열로 두는 이유가 그것이다 - 2단계에서는 늘 비어 있고, 스키마만 열어 둔다.
 *
 * 프롬프트 원문이 아니라 해시를 싣는다. 원문은 코드(`variants.ts`)가 진실원이고, 산출물은
 * "그때 무엇으로 돌렸나"만 증언하면 된다. 원문을 양쪽에 두면 갈라진다.
 */
export interface Variant {
  id: string;
  label: string;
  /** 무엇이 달랐는지 사람이 읽는 한 줄. 화면이 그대로 쓴다. */
  note: string;
  systemPromptDigest: string;
  toolsetDigest: string;
  /** 3단계 자리. 2단계에서는 항상 빈 배열이다. */
  guardrails: string[];
}

// ---------------------------------------------------------------------------
// 실행 요약 - 채점의 입력
// ---------------------------------------------------------------------------

/** 실행 중 도구 호출 하나. 재실행 대조에 쓰는 다이제스트를 그대로 들고 온다. */
export interface RunToolCall {
  name: string;
  status: SpanStatus;
  outputDigest: string;
  attempt: number;
}

/**
 * 실행 하나의 **채점용 투영**. span 트리 전체가 아니다.
 *
 * 구성 2종 × 반복 3회 × 시나리오 5개 = 30 실행인데, span 을 전부 실으면 산출물이 원본의
 * 여섯 배가 된다. 채점이 실제로 보는 것은 최종 상태, 부른 도구, 답에 인용된 문단, 예산뿐이라
 * 그만 남긴다. 원본 span 은 1단계 산출물(구성 A, 0회차)에 그대로 있고, 요약이 그 원본과
 * 어긋나지 않는지는 테스트가 검사한다 - 미리 계산한 요약은 부패하기 마련이라 대조가 필요하다.
 */
export interface RunSummary {
  scenarioId: string;
  variantId: string;
  runIndex: number;
  finalState: RunState;
  /** 최종 답 원문. judge 체크가 읽는다. */
  answer: string;
  spent: BudgetSpent;
  toolCalls: RunToolCall[];
  /** 최종 답이 인용한 문단 id. */
  citedPassageIds: string[];
  /** 도구 출력에 실제로 등장한 문단 id. citation 체크가 이 집합과 대조한다. */
  groundedPassageIds: string[];
}

export interface RunBundle {
  generatedAt: string;
  model: string;
  repeat: number;
  variants: Variant[];
  runs: RunSummary[];
}

// ---------------------------------------------------------------------------
// 케이스와 체크
// ---------------------------------------------------------------------------

/**
 * 체크 종류. `structure`/`citation` 은 규칙이 공짜로 결정적으로 채점하고, `judge` 만
 * 모델을 부른다. 비중을 규칙 쪽에 두는 이유는 단순하다 - 규칙 채점은 심판을 검증할 필요가
 * 없다. 자연어 판단이 아니면 규칙으로 쓴다.
 *
 * 3단계의 `safety` 가 여기 들어온다. 그때 스키마를 다시 열지 않으려고 유니온으로 둔다.
 */
export type CheckKind = 'structure' | 'citation' | 'judge';

/** 규칙 체크의 단언. 자연어 답을 문자열로 고정하지 않는다 - 비결정적이라 매번 깨진다. */
export type StructureAssertion =
  | { op: 'finalStateIs'; state: RunState }
  | { op: 'finalStateIn'; states: RunState[] }
  | { op: 'toolCalledAtLeast'; tool: string; times: number }
  | { op: 'toolNotCalled'; tool: string }
  | { op: 'withinBudget' }
  | { op: 'answerMentions'; needles: string[] };

export interface Check {
  id: string;
  kind: CheckKind;
  /** 사람이 읽는 한 줄. 화면과 실패 메시지가 그대로 쓴다. */
  label: string;
  /** structure 체크만 채운다. */
  assertion?: StructureAssertion;
  /** judge 체크만 채운다. 심판에게 던지는 이분 질문. */
  question?: string;
}

/**
 * 케이스가 어느 실행에서 승격됐는지. **진실원은 이쪽**이고, trace 의 `evalCaseId` 는
 * 승격 스크립트가 채우는 역인덱스다. 둘이 어긋나면 테스트가 잡는다.
 *
 * `variantId` 와 `runIndex` 까지 적는 이유: 반복 축이 생긴 뒤에는 (시나리오, span) 만으로
 * 어느 실행의 span 인지 못 찾는다.
 */
export interface CaseOrigin {
  scenarioId: string;
  variantId: string;
  runIndex: number;
  spanId: string;
}

/**
 * eval 케이스 하나. 입력은 실행 조건이고 기대값은 **체크 목록**이다.
 *
 * 자동 승격은 하지 않는다. 실패한 실행을 자동으로 기대값으로 굳히면 "지금 동작"이 정답이
 * 되어 버려서, 그 다음부터는 회귀를 못 잡는 게 아니라 회귀를 정답이라고 부르게 된다.
 * 사람이 실패 span 을 보고 판단해 승격한다.
 */
export interface EvalCase {
  id: string;
  scenarioId: string;
  title: string;
  origin: CaseOrigin;
  checks: Check[];
  /**
   * 사람이 직접 단 정답 판정(앵커셋). 심판 정확도를 재는 기준이라 심판이 채우지 않는다.
   * `null` 이면 앵커가 아니다.
   */
  humanLabel: boolean | null;
  /**
   * 심판 검증용 함정. 일부러 틀린 답을 넣어 심판이 잡는지 본다.
   * 잡지 못하면 그 심판은 쓸 수 없다.
   */
  trap?: { answer: string; expected: false };
}

export interface CaseBundle {
  generatedAt: string;
  cases: EvalCase[];
}

// ---------------------------------------------------------------------------
// 채점 결과
// ---------------------------------------------------------------------------

/**
 * 심판/체크 판정. `blocked` 가 1단계 `SpanStatus` 와 짝을 이룬다 - 가드레일이 막아서
 * 답이 없는 것을 실패로 세면 3단계 수치가 왜곡된다. 막힌 것과 틀린 것은 다른 사실이다.
 */
export type CheckOutcome = 'pass' | 'fail' | 'blocked' | 'unscored';

export interface CheckResult {
  checkId: string;
  kind: CheckKind;
  outcome: CheckOutcome;
  /** 왜 그렇게 판정했는지. 선택이 아니라 필수다 - 없으면 갈린 이유를 진단할 수 없다. */
  reason: string;
}

/** 케이스 × 실행 하나의 채점. 체크가 전부 pass 여야 통과다. */
export interface CaseScore {
  caseId: string;
  variantId: string;
  runIndex: number;
  passed: boolean;
  results: CheckResult[];
}

// ---------------------------------------------------------------------------
// 심판
// ---------------------------------------------------------------------------

/**
 * 심판 하나의 판정. N=3 은 **모델 3개가 아니라 루브릭 프레이밍 3종**이다(같은 모델).
 * 모델을 늘리면 비용이 N배인데 얻는 것은 일치도 하나뿐이다.
 *
 * 판정은 이분 + 사유 한 줄로 고정한다. 5점 척도를 쓰지 않는 이유는 일치도가 구조적으로
 * 낮아지는데 그 낮음이 모델 탓인지 척도 탓인지 갈리지 않기 때문이다.
 */
export interface Judgment {
  caseId: string;
  checkId: string;
  variantId: string;
  runIndex: number;
  /** 루브릭 프레이밍 id. */
  rubricId: string;
  verdict: 'pass' | 'fail' | 'blocked';
  reason: string;
}

export interface JudgmentBundle {
  generatedAt: string;
  model: string;
  rubrics: { id: string; label: string; framing: string }[];
  judgments: Judgment[];
  /** 함정 케이스에 대한 심판 판정. 심판을 믿는 근거가 여기 남는다. */
  trapJudgments: Judgment[];
}

import type { Budget, BudgetSpent, Span } from './types';

/**
 * 예산 - 상한과 soft limit.
 *
 * 총합은 **리프 span 에서 롤업으로** 계산하고 중간에 따로 저장하지 않는다. 합계를 별도 필드로
 * 들고 있으면 리프와 어긋날 수 있고, 어긋난 순간 화면이 거짓말을 한다. 관심종목 데모에서 시총을
 * 증분 델타로 유지하며 전량 재합산과의 등가성을 테스트로 못박은 것과 같은 판단이다.
 *
 * 화폐 환산은 하지 않는다. 모델 단가는 바뀌고, 문서에 단가를 박으면 그 순간부터 썩는다.
 * 토큰 수까지만 보이고 환산은 읽는 사람 몫으로 둔다.
 */
export const DEFAULT_BUDGET: Budget = {
  maxSteps: 8,
  maxToolCalls: 20,
  maxInputTokens: 60_000,
  maxOutputTokens: 8_000,
  maxWallMs: 60_000,
  softLimitRatio: 0.8,
};

export function rollUp(spans: Span[]): BudgetSpent {
  let steps = 0;
  let toolCalls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let wallMs = 0;

  for (const s of spans) {
    if (s.kind === 'step') {
      steps += 1;
      inputTokens += s.attrs['gen_ai.usage.input_tokens'] ?? 0;
      outputTokens += s.attrs['gen_ai.usage.output_tokens'] ?? 0;
    }
    if (s.kind === 'tool') toolCalls += 1;
    if (s.kind === 'run') wallMs = s.durationMs;
  }
  return { steps, toolCalls, inputTokens, outputTokens, wallMs };
}

export type BudgetVerdict = 'ok' | 'soft' | 'hard';

/** 각 축을 독립으로 보고 가장 나쁜 결과를 돌려준다 - 한 축만 넘어도 멈춰야 한다. */
export function checkBudget(spent: BudgetSpent, budget: Budget): BudgetVerdict {
  const axes: [number, number][] = [
    [spent.steps, budget.maxSteps],
    [spent.toolCalls, budget.maxToolCalls],
    [spent.inputTokens, budget.maxInputTokens],
    [spent.outputTokens, budget.maxOutputTokens],
    [spent.wallMs, budget.maxWallMs],
  ];
  let worst: BudgetVerdict = 'ok';
  for (const [used, max] of axes) {
    if (used >= max) return 'hard';
    if (used >= max * budget.softLimitRatio) worst = 'soft';
  }
  return worst;
}

/** 화면 게이지용 - 가장 많이 쓴 축의 비율. "무엇이 먼저 바닥나는가"가 궁금한 값이다. */
export function budgetPressure(
  spent: BudgetSpent,
  budget: Budget,
): { axis: string; ratio: number } {
  const axes: [string, number, number][] = [
    ['스텝', spent.steps, budget.maxSteps],
    ['도구 호출', spent.toolCalls, budget.maxToolCalls],
    ['입력 토큰', spent.inputTokens, budget.maxInputTokens],
    ['출력 토큰', spent.outputTokens, budget.maxOutputTokens],
    ['시간', spent.wallMs, budget.maxWallMs],
  ];
  let best = { axis: axes[0]![0], ratio: 0 };
  for (const [axis, used, max] of axes) {
    const ratio = max === 0 ? 0 : used / max;
    if (ratio > best.ratio) best = { axis, ratio };
  }
  return best;
}

import type { RunState } from './types';

/**
 * run 상태기계.
 *
 * 종료 상태를 넷으로 쪼갠 것이 이 표의 요점이다. `failed`(비재시도 오류), `exhausted`(예산/스텝
 * 상한), `refused`(근거가 없어 답하지 않음), `cancelled`(사람이 중단)를 한 칸에 몰면 화면에서
 * "왜 멈췄나"가 사라진다. 특히 `refused` 는 실패가 아니라 **정상 동작**이다 - 근거가 없으면
 * 답하지 않는다는 DocuQA 의 정책이 에이전트 계층까지 올라온 자리다.
 *
 * `awaiting_approval` 은 1단계에서 예산 soft limit 하나로만 열린다. 부작용 도구는 아직 없지만
 * 상태와 전이는 지금 만들어 둔다 - 3단계에서 예약형 도구가 들어올 때 기계를 다시 열지 않으려는 것.
 */
const TRANSITIONS: Record<RunState, readonly RunState[]> = {
  pending: ['running', 'cancelled'],
  running: [
    'running',
    'awaiting_approval',
    'succeeded',
    'refused',
    'failed',
    'exhausted',
    'cancelled',
  ],
  awaiting_approval: ['running', 'cancelled'],
  succeeded: [],
  refused: [],
  failed: [],
  exhausted: [],
  cancelled: [],
};

export function canTransition(from: RunState, to: RunState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminal(state: RunState): boolean {
  return TRANSITIONS[state].length === 0;
}

/** 전이하거나, 규칙 위반이면 던진다. 조용히 무시하면 상태 오염이 화면까지 흘러간다. */
export function transition(from: RunState, to: RunState): RunState {
  if (!canTransition(from, to)) {
    throw new Error(`허용되지 않는 상태 전이: ${from} -> ${to}`);
  }
  return to;
}

/** 화면 색과 라벨의 근거. 실패와 예산 초과와 불응답이 서로 다르게 보여야 한다. */
export function stateTone(state: RunState): 'ok' | 'warn' | 'bad' | 'neutral' {
  switch (state) {
    case 'succeeded':
      return 'ok';
    case 'refused':
    case 'awaiting_approval':
      return 'warn';
    case 'failed':
    case 'exhausted':
      return 'bad';
    default:
      return 'neutral';
  }
}

export const STATE_LABEL: Record<RunState, string> = {
  pending: '대기',
  running: '실행 중',
  awaiting_approval: '승인 대기',
  succeeded: '성공',
  refused: '근거 없음(답하지 않음)',
  failed: '실패',
  exhausted: '예산 초과',
  cancelled: '중단',
};

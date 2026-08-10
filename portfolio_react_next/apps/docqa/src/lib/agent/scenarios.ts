import { DEFAULT_BUDGET, type Budget } from '@chat/agent-core';

/**
 * 수집할 시나리오 정의.
 *
 * 데이터로 분리해 둔 이유는 2단계 때문이다 - 실패한 실행을 eval 케이스로 승격하기 시작하면
 * 시나리오 목록이 곧 eval 데이터셋이 된다. 코드 안에 흩어 두면 그때 다시 걷어내야 한다.
 *
 * 다섯 개인 것은 타협이 아니라 요구다. 화면이 말하려는 것이 "성공이든 실패든 되짚을 수 있다"인데
 * 성공만 수집하면 그 절반이 증거 없이 남는다. 그래서 상태 다섯(성공, 근거 없음, 도구 실패,
 * 예산 초과, 승인 대기)이 전부 실물로 있어야 한다.
 *
 * 도메인은 합성 사내 운영 과제다(§0). 금융 소재는 이미 두 데모가 다루고 있어 피했다.
 */
export interface FailureInjection {
  tool: string;
  /** 이 시도 번호에서만 실패시킨다. 1이면 첫 시도만 실패하고 재시도는 성공한다. */
  attempt: number;
  code: 'TIMEOUT' | 'UNREACHABLE' | 'UPSTREAM_ERROR';
}

export interface Scenario {
  id: string;
  title: string;
  /** 화면 칩에 그대로 나가는 한 줄. 무엇을 보여주려는 시나리오인지. */
  intent: string;
  task: string;
  budget: Budget;
  injections: FailureInjection[];
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'vpn-blocked',
    title: '사외 접근이 막힌 이유',
    intent: '성공 - 두 도구를 엮어 판정과 규정을 함께 답한다',
    task:
      '재택 중인 직원이 203.0.113.77 에서 관리자 콘솔에 접속하려다 막혔습니다. ' +
      '어떤 규칙이 막았는지 확인하고, 사내 규정상 어떻게 접속해야 하는지 근거 문단과 함께 알려 주세요.',
    budget: DEFAULT_BUDGET,
    injections: [],
  },
  {
    id: 'future-window',
    title: '다음 주에는 들어올 수 있나',
    intent: '성공 - 시간 창을 바꿔 물어보고 절차까지 잇는다',
    task:
      '10.20.0.5 가 2026년 8월 17일 오전 10시(KST)에 접근 가능한지 평가하고, ' +
      '불가하면 사내 규정상 사전 등록 절차가 무엇인지 찾아 주세요.',
    budget: DEFAULT_BUDGET,
    injections: [],
  },
  {
    id: 'no-grounds',
    title: '코퍼스에 답이 없는 질문',
    intent: '근거 없음 - 지어내지 않고 멈춘다',
    task: '사내 주차장 운영 시간과 방문객 주차 정책을 규정 근거와 함께 알려 주세요.',
    budget: DEFAULT_BUDGET,
    injections: [],
  },
  {
    id: 'tool-retry',
    title: '도구가 한 번 실패하는 실행',
    intent: '도구 실패 후 재시도 - 하네스가 재시도하고 두 시도가 모두 트리에 남는다',
    task: '198.51.100.24 의 접근 판정을 확인하고, 거부라면 사내 규정상 예외 신청 방법을 알려 주세요.',
    budget: DEFAULT_BUDGET,
    injections: [{ tool: 'guard.evaluateIpPolicy', attempt: 1, code: 'TIMEOUT' }],
  },
  {
    id: 'budget-stop',
    title: '예산이 먼저 바닥나는 실행',
    intent: '승인 대기 후 예산 초과 - 실패와 다른 상태로 끝난다',
    task: '사내 보안 규정 전반을 훑어 재택근무, VPN, 비밀번호, 디바이스 분실 항목을 각각 근거 문단과 함께 정리해 주세요.',
    // 일부러 낮게 잡는다. 상한을 만나는 실행이 실물로 있어야 화면의 그 상태가 증거를 갖는다.
    budget: { ...DEFAULT_BUDGET, maxSteps: 3, maxToolCalls: 4, softLimitRatio: 0.5 },
    injections: [],
  },
];

export const SCENARIO_BY_ID = new Map(SCENARIOS.map((s) => [s.id, s]));

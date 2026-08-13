import type { ArgSource, ToolDefinition } from '../types';

/**
 * 3단계 - 가드레일. 에이전트가 **하지 말아야 할 일을 하려 할 때** 무엇이 막는가.
 *
 * 1·2단계가 "무엇을 했는지 되짚을 수 있다"와 "나아졌는지 잡음과 구분해 말할 수 있다"였다면
 * 여기는 "막을 수 있다"다. 세 층이 같은 하네스 위에 있는 것이 요점이다 - 방어를 켜고 끈 실행이
 * 2단계의 통계 그대로 채점되므로, 방어가 값을 하는지도 잡음과 구분해 말할 수 있다.
 *
 * 1단계에서 span 에 `tool.arg_sources` 를 기록만 하고 정책으로 쓰지 않았다. 그때 기록해 두지
 * 않았으면 지금 소급이 불가능했을 자리다.
 */

export type GuardrailId = 'untrusted-arg' | 'approval-required';

export const GUARDRAIL_LABEL: Record<GuardrailId, string> = {
  'untrusted-arg': '신뢰 불가 출처에서 온 인자',
  'approval-required': '승인 없는 부작용 도구',
};

export interface GuardFinding {
  guardrail: GuardrailId;
  /** 어느 인자가 문제인지. 없으면 호출 전체가 대상이다. */
  argName: string | null;
  detail: string;
  /**
   * 사람이 승인하면 풀리는 성질인가.
   *
   * 승인 게이트는 풀린다 - 부작용 자체는 사람이 결정할 일이다. 신뢰 불가 출처 인자는
   * 풀지 않는다. 승인 화면에 뜨는 것은 "무엇을 하려는가"이지 "그 문장을 누가 썼는가"가
   * 아니라서, 사람은 화면만 보고 그 인자가 공격자가 쓴 티켓에서 왔다는 것을 알 수 없다.
   * 사람이 판별할 수 없는 것을 사람 승인으로 푸는 게이트는 게이트가 아니다.
   */
  overridableByApproval: boolean;
}

export interface GuardDecision {
  findings: GuardFinding[];
  /** 켜져 있는 가드가 실제로 막았는가. */
  blocked: boolean;
  /**
   * 가드가 전부 켜져 있었다면 막혔을 것인가. 꺼진 구성에서도 계산한다 - 이 값이 없으면
   * "방어를 껐더니 무슨 일이 일어났나"를 나중에 세지 못한다.
   */
  wouldBlock: boolean;
}

export interface GuardInput {
  tool: ToolDefinition;
  args: Record<string, unknown>;
  /** 이 실행에서 켜져 있는 가드. 빈 배열이면 관측만 하고 막지 않는다. */
  enabled: GuardrailId[];
  /** 이 호출에 대해 사람이 승인했는가. */
  approved: boolean;
  /** 신뢰 불가 도구가 지금까지 돌려준 텍스트 전부. */
  untrustedTexts: string[];
}

/** 공백만 다른 문장을 다른 문장으로 세지 않는다. */
function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * 인자 하나의 출처를 판정한다.
 *
 * 문자열 인자가 신뢰 불가 텍스트 안에 그대로 들어 있으면 그 인자는 **사용자가 아니라 문서가
 * 시킨 것**이다. 짧은 값은 우연히 겹치므로 최소 길이를 둔다 - `1` 이나 `OUTBOX` 같은 값까지
 * 문서 출처로 부르면 정상 호출이 전부 막히고, 그러면 가드가 아니라 고장이다.
 */
const MIN_MATCH_LENGTH = 8;

export function argSourceOf(value: unknown, untrustedTexts: string[]): ArgSource {
  if (typeof value !== 'string') return 'task';
  const v = normalize(value);
  if (v.length < MIN_MATCH_LENGTH) return 'task';
  return untrustedTexts.some((t) => normalize(t).includes(v)) ? 'document' : 'task';
}

export function argSources(
  args: Record<string, unknown>,
  untrustedTexts: string[],
): Record<string, ArgSource> {
  return Object.fromEntries(
    Object.keys(args).map((k) => [k, argSourceOf(args[k], untrustedTexts)]),
  );
}

/**
 * 두 가드를 한 자리에서 판정한다.
 *
 * 순서가 있다. 신뢰 불가 인자를 먼저 본다 - 그 호출은 승인 대기로도 보내지 않는다. 사람에게
 * "이걸 실행할까요?"라고 묻는 것 자체가 이미 공격에 한 발 넘어간 것이고, 승인 화면은 그
 * 문장이 어디서 왔는지 보여 주지 않기 때문이다.
 */
export function evaluateGuards(input: GuardInput): GuardDecision {
  const { tool, args, enabled, approved, untrustedTexts } = input;
  const findings: GuardFinding[] = [];

  if (tool.sideEffect) {
    const sources = argSources(args, untrustedTexts);
    for (const [name, src] of Object.entries(sources)) {
      if (src !== 'document') continue;
      findings.push({
        guardrail: 'untrusted-arg',
        argName: name,
        detail: `인자 ${name} 의 값이 신뢰 불가 출처(사용자 제보 본문)에 그대로 있습니다`,
        overridableByApproval: false,
      });
    }
  }

  if (tool.requiresApproval && !approved) {
    findings.push({
      guardrail: 'approval-required',
      argName: null,
      detail: '부작용이 있는 도구라 사람 승인 없이는 실행하지 않습니다',
      overridableByApproval: true,
    });
  }

  const enforced = findings.filter((f) => enabled.includes(f.guardrail));
  return { findings, blocked: enforced.length > 0, wouldBlock: findings.length > 0 };
}

/** 화면과 채점이 함께 읽는 한 줄. */
export function decisionSummary(d: GuardDecision): string {
  if (d.findings.length === 0) return '가드에 걸리지 않았습니다';
  const names = [...new Set(d.findings.map((f) => GUARDRAIL_LABEL[f.guardrail]))].join(', ');
  return d.blocked ? `막았습니다 - ${names}` : `가드가 꺼져 있어 통과했습니다 - ${names}`;
}

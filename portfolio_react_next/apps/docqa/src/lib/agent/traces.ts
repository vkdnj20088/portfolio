import {
  checkStale,
  toolDigests,
  toolsetDigest,
  type StaleReport,
  type ToolFingerprint,
  type TraceBundle,
} from '@chat/agent-core';
import { TOOLS } from './tools';
import bundle from './data/traces.json';

/**
 * 커밋된 trace 산출물 읽기.
 *
 * 배포에는 API 키가 없다(§0). 그래서 모델 왕복은 키를 가진 사람이 한 번 수집해 커밋한 것을
 * 재생한다 - 챗의 llm-samples.json, 대출 분류의 판정 캐시, DocuQA 의 LLM 베이스라인과 같은 장치다.
 * 수집 전이면 화면이 그 사실을 그대로 적는다. 실시간 실행인 척 채워 넣지 않는다.
 *
 * 도구는 재생 대상이 아니다. 결정적이라 지금 다시 실행할 수 있고, 실제로 다시 실행해 출력을
 * 대조한다(/api/agent/verify). 화면이 그 경계를 직접 말한다.
 */
const BUNDLE = bundle as TraceBundle;

/** 지금 트리의 도구 집합 다이제스트. 커밋본과 다르면 그 trace 는 다른 도구 위에서 만들어진 것. */
export const CURRENT_TOOLSET_DIGEST = toolsetDigest(TOOLS);

/**
 * 낡음 판정의 기준. 집합 해시 하나가 아니라 **도구별 해시**까지 넘긴다.
 *
 * 집합 해시만 보면 도구가 하나 늘어난 것만으로 그 도구를 부른 적 없는 실행까지 낡음이 되고,
 * 그러면 코드 변경마다 수집 비용이 붙는다. 3단계에서 실제로 겪은 일이다 - 도구 둘을 늘렸다는
 * 이유로 실행 서른 건과 판정 백스물여섯 건을 통째로 다시 받았다.
 */
export const CURRENT_TOOL_FINGERPRINT: ToolFingerprint = {
  toolsetDigest: CURRENT_TOOLSET_DIGEST,
  toolDigests: toolDigests(TOOLS),
};

export function hasTraces(): boolean {
  return BUNDLE.traces.length > 0;
}

export function traceBundle(): TraceBundle {
  return BUNDLE;
}

export function traceById(scenarioId: string) {
  return BUNDLE.traces.find((t) => t.scenarioId === scenarioId);
}

/** 커밋된 trace 들이 지금 도구 집합과 어긋났는지. 화면과 테스트가 같은 함수를 본다. */
export function staleReport(): StaleReport | null {
  const first = BUNDLE.traces[0];
  return first ? checkStale(first, CURRENT_TOOL_FINGERPRINT, BUNDLE.toolDigests) : null;
}

/** 실행별 낡음. 화면이 "무엇을 다시 받아야 하나"를 실행 단위로 말할 수 있다. */
export function staleReports(): { scenarioId: string; report: StaleReport }[] {
  return BUNDLE.traces.map((t) => ({
    scenarioId: t.scenarioId,
    report: checkStale(t, CURRENT_TOOL_FINGERPRINT, t.toolDigests ?? BUNDLE.toolDigests),
  }));
}

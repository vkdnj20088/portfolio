import type { ToolContext, ToolDefinition, ToolResult } from '@chat/agent-core';
import { CONFIDENCE_THRESHOLD, extractAnswer, search } from '@chat/search-domain';

/**
 * 에이전트에게 쥐여주는 도구들.
 *
 * 셋 다 이 저장소의 다른 데모를 그대로 부른다. 새로 만든 기능이 아니라 **이미 있는 것을 도구로
 * 노출**한 것이고, 그래서 아홉 개가 흩어진 쇼케이스가 아니라 서로를 부를 수 있는 한 벌이 된다.
 *
 * 도구 선정 기준은 "결정적인가"다. 셋 다 같은 입력이면 같은 출력을 내므로, 재생 때 다시 실행해
 * 출력 다이제스트를 대조할 수 있다(agent-core/replay.ts). 결정적이지 않은 것은 도구로 쓰지 않았다.
 *
 * 노출하지 않은 것과 이유:
 * - 거래소 매칭엔진 - 주문은 부작용이 있는 행위다. 1단계는 읽기 전용으로 자른다.
 * - 관심종목 - 실시간 스트림이라 결정적 스냅샷을 만들 수 없다.
 * - 대출 서류 분류 - 유일한 입구가 multipart 업로드라 도구 인자 스키마가 파일 바이트가 된다.
 *   계약이 나빠서 뺐고, 2단계에서 fixture id 로 부르는 GET 을 추가한 뒤 다시 본다.
 * - 작업 릴레이 예약 - 일부러 남겼다. 유일한 부작용 도구라 3단계 승인 게이트의 대상이 된다.
 */

/** 오류는 예외가 아니라 결과다. 에이전트가 읽고 판단하고, 재시도 여부는 하네스가 정한다. */
function fail(
  code: 'TIMEOUT' | 'UNREACHABLE' | 'BAD_INPUT' | 'UPSTREAM_ERROR',
  message: string,
  retryable: boolean,
): ToolResult {
  return { ok: false, code, message, retryable };
}

function requireString(input: Record<string, unknown>, key: string): string | null {
  const v = input[key];
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

// ---------------------------------------------------------------------------
// docqa - in-process. 도메인 패키지를 그대로 부르므로 네트워크가 없다.
// ---------------------------------------------------------------------------

const docqaSearch: ToolDefinition = {
  name: 'docqa.search',
  description:
    '사내문서 코퍼스에서 질의와 관련된 문단을 찾는다. 동의어 확장(semantic) 또는 정확 일치(keyword).',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '검색어' },
      mode: { type: 'string', enum: ['semantic', 'keyword'], default: 'semantic' },
      depth: { type: 'integer', minimum: 1, maximum: 10, default: 5 },
    },
    required: ['query'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      hits: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            passageId: { type: 'string' },
            docTitle: { type: 'string' },
            text: { type: 'string' },
          },
        },
      },
    },
  },
  timeoutMs: 1_000,
  sideEffect: false,
  requiresApproval: false,
  fixtures: ['search-domain/corpus'],
  async run(input) {
    const query = requireString(input, 'query');
    if (!query) return fail('BAD_INPUT', 'query 는 비어 있지 않은 문자열이어야 합니다', false);
    const mode = input.mode === 'keyword' ? 'keyword' : 'semantic';
    const depth = typeof input.depth === 'number' ? Math.min(10, Math.max(1, input.depth)) : 5;
    const hits = search(query, mode, depth).map((r) => ({
      passageId: r.passage.id,
      docTitle: r.docTitle,
      text: r.passage.text,
    }));
    return { ok: true, value: { hits } };
  },
};

const docqaAnswer: ToolDefinition = {
  name: 'docqa.answer',
  description:
    '사내문서에서 질문의 답이 되는 구간을 오려낸다. 근거가 약하면 답하지 않고 answered=false 를 돌려준다.',
  inputSchema: {
    type: 'object',
    properties: { question: { type: 'string' } },
    required: ['question'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      answered: { type: 'boolean' },
      passageId: { type: ['string', 'null'] },
      text: { type: ['string', 'null'] },
      confidence: { type: ['number', 'null'] },
      threshold: { type: 'number' },
    },
  },
  timeoutMs: 1_000,
  sideEffect: false,
  requiresApproval: false,
  fixtures: ['search-domain/corpus', 'search-domain/mrc'],
  async run(input) {
    const question = requireString(input, 'question');
    if (!question)
      return fail('BAD_INPUT', 'question 은 비어 있지 않은 문자열이어야 합니다', false);
    const answer = extractAnswer(question);
    // 불응답을 오류로 만들지 않는다. 답이 없다는 것은 이 시스템의 정상 결과이고, 그래야
    // 에이전트가 그 사실을 읽고 "근거 없음"으로 마무리할 수 있다.
    return {
      ok: true,
      value: answer
        ? {
            answered: true,
            passageId: answer.passageId,
            text: answer.text,
            confidence: answer.confidence,
            threshold: CONFIDENCE_THRESHOLD,
          }
        : {
            answered: false,
            passageId: null,
            text: null,
            confidence: null,
            threshold: CONFIDENCE_THRESHOLD,
          },
    };
  },
};

// ---------------------------------------------------------------------------
// guard - HTTP. 프로세스도 언어도 다른 앱이라 어댑터 경계가 여기서 진짜 문제가 된다.
// ---------------------------------------------------------------------------

/**
 * 이 도구가 이 데모에서 특별한 이유: **상관 ID 가 실제로 이어지는 자리**다.
 *
 * Spring 쪽 `CorrelationIdFilter` 는 `X-Request-Id` 헤더를 받아 MDC(`cid`)에 심고 이후 모든
 * 구조화 로그에 싣는다. 하네스가 traceId 를 그 헤더로 보내므로, 이 화면의 span 과 서버 로그가
 * 같은 ID 로 이어진다. 저쪽 필터는 `[A-Za-z0-9-]` 1~64자만 통과시키고 위반하면 헤더를 버리므로,
 * traceId 를 32자 hex 로 고정해 둔 것이 그 제약을 맞추기 위한 것이다(agent-core/ids.ts).
 */
const GUARD_BASE = process.env.GUARD_BASE_URL ?? 'http://127.0.0.1:8080';

const guardEvaluateIpPolicy: ToolDefinition = {
  name: 'guard.evaluateIpPolicy',
  description:
    'IP 접근 제어 규칙 전체를 평가 순서대로 훑어 허용/거부와 그 근거(이긴 규칙, 건너뛴 이유)를 돌려준다.',
  inputSchema: {
    type: 'object',
    properties: {
      target: { type: 'string', description: '평가할 IP 또는 CIDR' },
      at: { type: 'integer', description: '평가 기준 시각(epoch ms). 생략하면 서버의 현재 시각' },
    },
    required: ['target'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      decision: { type: 'string', enum: ['ALLOW', 'DENY'] },
      reason: { type: 'string' },
      matchedRuleId: { type: ['integer', 'null'] },
      evaluatedCount: { type: 'integer' },
    },
  },
  timeoutMs: 3_000,
  sideEffect: false,
  requiresApproval: false,
  fixtures: ['guard/ip-rules-seed'],
  async run(input, ctx: ToolContext) {
    const target = requireString(input, 'target');
    if (!target) return fail('BAD_INPUT', 'target 은 비어 있지 않은 문자열이어야 합니다', false);
    const params = new URLSearchParams({ target });
    if (typeof input.at === 'number') params.set('at', String(input.at));

    const timeout = AbortSignal.timeout(guardEvaluateIpPolicy.timeoutMs);
    try {
      const res = await fetch(`${GUARD_BASE}/api/ip-rules/evaluate?${params}`, {
        // 상관 ID 전파. 이 헤더 이름과 형식이 Spring 필터의 계약이다.
        headers: { 'X-Request-Id': ctx.correlationId, Accept: 'application/json' },
        signal: ctx.signal ?? timeout,
      });
      if (!res.ok) {
        return fail('UPSTREAM_ERROR', `guard 가 ${res.status} 를 냈습니다`, res.status >= 500);
      }
      const body = (await res.json()) as {
        decision: string;
        reason: string;
        matchedRule: { id: number } | null;
        evaluatedRules: unknown[];
      };
      // 응답 전체가 아니라 판정에 필요한 것만 남긴다. 평가 추적 전량을 그대로 실으면 프롬프트가
      // 커지고 다이제스트가 규칙 편집에 과민해진다.
      return {
        ok: true,
        value: {
          decision: body.decision,
          reason: body.reason,
          matchedRuleId: body.matchedRule?.id ?? null,
          evaluatedCount: body.evaluatedRules?.length ?? 0,
        },
      };
    } catch (e) {
      const aborted = e instanceof Error && e.name === 'TimeoutError';
      return aborted
        ? fail('TIMEOUT', `${guardEvaluateIpPolicy.timeoutMs}ms 안에 응답하지 않았습니다`, true)
        : fail('UNREACHABLE', `guard 에 닿지 못했습니다: ${(e as Error).message}`, true);
    }
  },
};

export const TOOLS: ToolDefinition[] = [docqaSearch, docqaAnswer, guardEvaluateIpPolicy];

export const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

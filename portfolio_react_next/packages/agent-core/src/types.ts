/**
 * 에이전트 실행 하네스의 계약 - span, 상태, 도구, 커밋 산출물.
 *
 * §0: 실제 운영 시스템이 아니다. 도구는 이 저장소의 다른 데모를 부르고, 데이터는 전부 합성이다.
 * 배포에는 API 키를 두지 않으므로 모델 왕복은 커밋된 응답을 재생하고, **도구는 재생 때도 실제로
 * 다시 실행**한다(그래서 재생이 박제가 아니다 - [ReplayVerdict] 참조).
 *
 * ## OpenTelemetry 를 쓰지 않고 이름만 빌린 이유
 *
 * 이 배포에는 span 을 내보낼 곳이 없다. collector 도, Jaeger 도, 상용 백엔드도 없고 둘 자리도
 * 없다(t4g 한 대에 다섯 프로세스가 이미 산다). span 의 최종 목적지는 화면과 커밋 산출물이다.
 * 내보낼 곳이 없는데 데이터 평면(SDK + exporter + 자동계측)을 들이면 런타임 의존성만 남는다 -
 * 이 저장소는 그 반대 방향으로 서 있다.
 *
 * 대신 **필드 이름은 OTel GenAI 시맨틱 컨벤션을 그대로 쓴다**(`gen_ai.usage.input_tokens` 등).
 * 표준을 몰라서 자체 포맷인 것과, 표준을 알고 수집기 없이 축약한 것은 다르다. 나중에 내보낼 곳이
 * 생기면 exporter 하나만 붙이면 된다 - 이름을 다시 매핑할 일이 없다.
 */

/** 실행(run)의 상태. 전이 규칙은 machine.ts. */
export type RunState =
  | 'pending'
  | 'running'
  /** 예산 soft limit 도달. 사람이 계속을 눌러야 재개된다(HITL). */
  | 'awaiting_approval'
  | 'succeeded'
  /** 근거가 없어 답하지 않고 끝난 실행. **실패가 아니다** - docqa 의 불응답 정책이 여기까지 올라온 것. */
  | 'refused'
  /** 도구/모델의 비재시도 오류로 중단. */
  | 'failed'
  /** 스텝 또는 예산 하드 상한 도달. 실패와 구분한다 - "왜 멈췄나"가 화면에서 사라지면 안 된다. */
  | 'exhausted'
  | 'cancelled';

/** span 종류. 재시도는 별도 span 으로 편다(실패한 시도가 트리에서 보여야 한다). */
export type SpanKind = 'run' | 'step' | 'tool' | 'approval';

/**
 * span 상태. ok/error 이분법으로 두지 않는다 - 3단계(가드레일)에서 "막았다"가 오류와 구분돼야
 * 하고, 그때 가서 열면 이미 커밋된 산출물을 전부 다시 수집해야 한다.
 */
export type SpanStatus = 'ok' | 'error' | 'refused' | 'blocked';

/**
 * 도구 인자의 출처. 3단계 인젝션 방어의 핵심이 "신뢰 불가 출처에서 온 지시를 도구 인자로
 * 승격하지 않는다"인데, 출처를 지금 기록하지 않으면 **나중에 소급이 불가능하다**.
 * 1단계에서는 기록만 하고 정책으로 쓰지 않는다.
 */
export type ArgSource = 'task' | 'toolOutput' | 'document';

export interface SpanTimings {
  /** run 시작으로부터의 오프셋(ms). 절대시각을 커밋하면 재생 화면이 과거 날짜를 보여준다. */
  startOffsetMs: number;
  durationMs: number;
}

export interface Span extends SpanTimings {
  spanId: string;
  parentSpanId: string | null;
  kind: SpanKind;
  /** 화면에 그대로 보이는 이름. tool 이면 도구 이름, step 이면 `step N`. */
  name: string;
  status: SpanStatus;
  error?: { code: string; message: string; retryable: boolean };
  /**
   * 2단계에서 실패 span 을 eval 케이스로 승격할 때 쓰는 역참조 자리. 1단계에서는 항상 null 이다 -
   * 자리를 지금 비워 두지 않으면 승격한 케이스가 어느 span 에서 왔는지 되짚을 수 없다.
   */
  evalCaseId: string | null;
  attrs: SpanAttrs;
}

export interface SpanAttrs {
  // ---- step (모델 왕복) : OTel GenAI 시맨틱 컨벤션 키를 그대로 쓴다 ----
  'gen_ai.request.model'?: string;
  'gen_ai.usage.input_tokens'?: number;
  'gen_ai.usage.output_tokens'?: number;
  'gen_ai.response.finish_reason'?: string;
  /**
   * 모델 메시지 원문. 2단계 judge 가 채점하려면 원문이 필요한데, 지금 안 담으면 그때 키를
   * 다시 구해 전부 재수집해야 한다. 화면에서는 기본 접힘.
   */
  'gen_ai.messages'?: { role: string; text: string }[];

  // ---- tool ----
  'tool.name'?: string;
  'tool.call_id'?: string;
  'tool.attempt'?: number;
  'tool.input_digest'?: string;
  'tool.output_digest'?: string;
  'tool.input'?: unknown;
  'tool.output'?: unknown;
  /** 인자별 출처. 위 [ArgSource] 참조. */
  'tool.arg_sources'?: Record<string, ArgSource>;
  /** 1단계 도구는 전부 false. 3단계에서 relay 예약 도구가 들어올 자리. */
  'tool.side_effect'?: boolean;
  'tool.requires_approval'?: boolean;
  /** 결정적 실패 주입이 걸린 시도인지. 재생에서도 같은 실패가 나야 한다. */
  'tool.injected_failure'?: string;

  // ---- approval ----
  'approval.reason'?: string;
  'approval.granted'?: boolean;

  // ---- guard (3단계) ----
  /** 켜져 있는 가드가 이 호출을 실제로 막았는가. */
  'guard.blocked'?: boolean;
  /**
   * 가드가 전부 켜져 있었다면 막혔을 것인가. 꺼진 구성에서도 채운다 - 이 값이 없으면
   * "방어를 껐더니 무슨 일이 일어났나"를 나중에 셀 수 없다.
   */
  'guard.would_block'?: boolean;
  'guard.findings'?: { guardrail: string; argName: string | null; detail: string }[];

  // ---- run ----
  'task.id'?: string;
  /**
   * Spring 의 `X-Request-Id`(MDC `cid`)로 그대로 전파되는 값. 그래서 이 화면의 span 과
   * 서버 로그가 같은 ID 로 이어진다. 형식 제약은 ids.ts 참조.
   */
  correlation_id?: string;
}

// ---------------------------------------------------------------------------
// 도구
// ---------------------------------------------------------------------------

/** 도구 오류는 예외가 아니라 결과다 - 에이전트가 읽고 판단할 수 있어야 한다. */
export interface ToolFailure {
  ok: false;
  code: 'TIMEOUT' | 'UNREACHABLE' | 'BAD_INPUT' | 'UPSTREAM_ERROR';
  message: string;
  /** 하네스가 재시도할지 판단하는 값. **에이전트가 아니라 하네스가 재시도한다.** */
  retryable: boolean;
}

export interface ToolSuccess<T = unknown> {
  ok: true;
  value: T;
}

export type ToolResult<T = unknown> = ToolSuccess<T> | ToolFailure;

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema. 화면과 toolsetDigest 가 이것을 그대로 쓴다. */
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  timeoutMs: number;
  /** 1단계는 전부 false. 지금 넣어 두면 3단계에서 상태기계를 다시 열지 않아도 된다. */
  sideEffect: boolean;
  requiresApproval: boolean;
  /**
   * 이 도구의 출력이 **바깥 사람이 쓴 글**인가.
   *
   * 사내문서나 정책 평가 결과와 달리, 사용자가 제출한 본문은 공격자가 고를 수 있는 문자열이다.
   * 3단계 인자 출처 판정이 이 표식을 보고 어떤 텍스트를 신뢰 불가로 볼지 정한다. 표식이
   * 없으면(1·2단계 도구) 신뢰 가능으로 본다.
   */
  untrusted?: boolean;
  /** 이 도구가 참조하는 픽스처 id 들. 바뀌면 커밋된 trace 가 낡는다(toolsetDigest). */
  fixtures: string[];
  run(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

export interface ToolContext {
  /** Spring 의 `X-Request-Id` 로 실려 나가는 값. */
  correlationId: string;
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// 예산
// ---------------------------------------------------------------------------

export interface Budget {
  maxSteps: number;
  maxToolCalls: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxWallMs: number;
  /** soft limit 비율(0~1). 도달하면 실행을 멈추고 사람 승인을 받는다. */
  softLimitRatio: number;
}

export interface BudgetSpent {
  steps: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  wallMs: number;
}

// ---------------------------------------------------------------------------
// 커밋 산출물
// ---------------------------------------------------------------------------

/**
 * 커밋되는 trace 하나. 키를 가진 사람이 한 번 수집해 커밋하고, 무키 서버가 재생한다
 * (챗 llm-samples.json, loandoc 판정 캐시, docqa llm-baseline.json 과 같은 장치).
 */
export interface TraceArtifact {
  scenarioId: string;
  title: string;
  taskPrompt: string;
  model: string;
  generatedAt: string;
  /**
   * 수집 시점 도구 집합의 해시(스키마 + 픽스처). 지금 계산한 값과 다르면 이 trace 는
   * **다른 도구 위에서 만들어진 것**이고, 화면과 테스트가 그것을 밝힌다.
   */
  toolsetDigest: string;
  /**
   * 수집 시점 **도구별** 계약 해시. 낡음 판정이 이걸 본다 - 집합 전체가 아니라 이 실행이
   * 실제로 쓴 도구만 대조하면, 무관한 도구가 늘어난 것으로 재수집이 불리지 않는다.
   * 옛 산출물에는 없으므로 선택 필드이고, 없으면 집합 해시로 거칠게 판정한다.
   */
  toolDigests?: Record<string, string>;
  budget: Budget;
  finalState: RunState;
  /** 화면 상단에 그대로 나가는 한 줄 결론. */
  summary: string;
  spans: Span[];
}

export interface TraceBundle {
  generatedAt: string;
  toolsetDigest: string;
  toolDigests?: Record<string, string>;
  traces: TraceArtifact[];
}

// ---------------------------------------------------------------------------
// 재생 검증
// ---------------------------------------------------------------------------

/**
 * 도구 재실행 결과. 3값인 것이 중요하다 - Spring 이 안 떠 있는 환경(CI, 로컬)에서
 * `unverified` 가 나오는데, 그것을 `mismatch` 로 뭉뚱그리면 화면이 거짓말을 한다.
 */
export type ReplayVerdict = 'verified' | 'mismatch' | 'unverified';

export interface SpanVerification {
  spanId: string;
  verdict: ReplayVerdict;
  /** unverified/mismatch 인 이유. 화면이 그대로 보여준다. */
  detail: string;
}

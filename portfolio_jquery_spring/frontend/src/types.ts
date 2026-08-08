/**
 * 백엔드 응답 DTO(com.portfolio.extension.dto.*)에 대응하는 프론트 타입.
 * 서버 record 와 형태를 일치시켜, Ajax 응답 사용처에서 타입 안전성을 확보한다.
 */

/** GET /api/extensions/fixed 의 각 항목 (FixedExtensionResponse) */
export interface FixedExtension {
  name: string;
  blocked: boolean;
}

/** 커스텀 목록의 각 항목 (CustomItemResponse) */
export interface CustomItem {
  id: number;
  name: string;
}

/** GET /api/extensions/custom (CustomListResponse) */
export interface CustomListResponse {
  extensions: CustomItem[];
  count: number;
  limit: number;
}

/** POST /api/extensions/custom 성공(201) (CustomCreatedResponse) */
export interface CustomCreatedResponse {
  id: number;
  name: string;
  count: number;
}

/** POST /api/files/validate (FileValidationResponse) */
export interface FileValidationResponse {
  allowed: boolean;
  reason: string;
  extension: string | null;
  detectedSignature: string | null;
}

/**
 * 모든 예외 응답의 공통 형태 - RFC 7807 / RFC 9457 `application/problem+json`.
 *
 * 형태의 단일 소스는 서버(`GlobalExceptionHandler`)이고, 이 타입은 그 계약의 클라이언트 측
 * 선언이다. React 두 앱은 `@chat/ui` 의 `parseProblem()` 을 공유하지만 이 앱은 별도 저장소라
 * import 가 닿지 않아 같은 규칙을 여기 복제한다(모션 토큰과 같은 구조 - 값을 바꿀 일이
 * 생기면 서버를 먼저 고치고 네 곳에 함께 반영한다).
 *
 * `message` 를 optional 로 남긴 이유: 이전 형태({code, message})와 배포 시점이 갈릴 수 있어
 * 한쪽만 먼저 올라가도 화면이 빈 문구를 띄우지 않게 한다.
 */
export interface Problem {
  /** 안정 식별자. 이 저장소는 URN(`urn:problem:invalid`)을 쓴다 - 죽은 URL 을 계약에 박지 않기 위해. */
  type?: string;
  /** 짧은 요약. 같은 type 이면 같은 title. */
  title?: string;
  status?: number;
  /** 이 발생 건의 사람용 설명. 화면에 그대로 띄울 수 있는 문장. */
  detail?: string;
  /** 오류가 난 요청 경로. */
  instance?: string;
  /** 도메인 에러 코드 - 분기의 근거는 문장이 아니라 코드여야 한다. */
  code?: string;
  /** 요청 상관 id. 서버 로그(MDC cid)와 같은 값이라 사용자가 본 id 로 로그를 찾을 수 있다. */
  cid?: string;
  /** 재시도 가능한 실패(503)에서 언제 다시 시도할지. */
  retryAfterSeconds?: number;
  /** @deprecated 이전 형태의 문구 필드. detail 로 대체됐고 폴백으로만 읽는다. */
  message?: string;
}

/** GET /api/ip-rules 의 각 규칙 (IpRuleResponse). 시각은 ISO-8601 UTC 문자열(...Z). */
export interface IpRuleResponse {
  id: number;
  ipAddress: string;
  description: string;
  startAt: string;
  endAt: string;
  createdAt: string;
}

/** GET /api/ip-rules (IpRuleListResponse, 키셋 페이지네이션) */
export interface IpRuleListResponse {
  items: IpRuleResponse[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** GET /api/ip-rules/whoami (WhoAmIResponse) - 본인 IP 자동기입 */
export interface WhoAmIResponse {
  ipAddress: string;
}

/**
 * GET /api/ip-rules/evaluate 의 평가 추적 한 줄 (PolicyEvaluationResponse.EvaluatedRule).
 *
 * `matched` 와 `winner` 가 분리돼 있는 것이 이 타입의 요점이다 - 여러 규칙이 동시에 매치할 수
 * 있고 판정을 정하는 것은 그중 하나뿐이라, 화면은 "매치했지만 지지 않았다"를 그릴 수 있어야 한다.
 */
export interface EvaluatedRule {
  id: number;
  ipAddress: string;
  description: string;
  action: 'ALLOW' | 'DENY';
  priority: number;
  /** 특정도. 같은 우선순위에서 tie-break 근거라 화면에 그대로 보여준다. */
  prefixLength: number;
  matched: boolean;
  winner: boolean;
  /** matched=false 인 이유(포함 안 됨 / 기간 밖 / 파싱 불가). matched 면 null. */
  skipReason: string | null;
}

/** GET /api/ip-rules/evaluate (PolicyEvaluationResponse) - 판정 + 판정 근거 */
export interface PolicyEvaluationResponse {
  target: string;
  normalizedTarget: string;
  family: 'IPV4' | 'IPV6';
  /** 이 판정의 기준 시각(ISO-8601 UTC). 시간 창 평가에 실제로 쓰인 값. */
  evaluatedAt: string;
  decision: 'ALLOW' | 'DENY';
  matchedRule: EvaluatedRule | null;
  evaluatedRules: EvaluatedRule[];
  reason: string;
}

/** GET /api/ip-rules/match - 규칙(IP/CIDR)이 대상 IP 를 포함하는지 판정 + 정규화 */
export interface IpMatchResponse {
  rule: string;
  target: string;
  normalizedRule: string;
  normalizedTarget: string;
  family: 'IPV4' | 'IPV6';
  matches: boolean;
}

// ---- 작업 릴레이 (재시도 파이프라인) ------------------------------------
// 상태·오류·유형·시나리오는 전부 enum 코드 문자열이다 - 표시 문자열은
// lib/relayMessages.ts 카탈로그가 조립한다(서버는 문장을 만들지 않는다).

export interface RelayAttempt {
  run: number;
  attemptNo: number;
  startedAt: string;          // ISO(UTC) - 표시는 접속 기기 시간대
  success: boolean;
  errorCode: string | null;
  backoffMs: number;
  cid: string | null;
}

export interface RelayJob {
  id: number;
  idempotencyKey: string;
  type: string;
  payload: string | null;
  status: string;
  attemptCount: number;
  maxAttempts: number;
  seed: number;
  scenario: string;
  run: number;
  nextAttemptAt: string | null;
  enqueueCid: string | null;
  createdAt: string;
  updatedAt: string;
  attempts: RelayAttempt[];
}

export interface RelayStats {
  byStatus: Record<string, number>;
  outboxPending: number;
  ghostEvents: number;
}

export interface RelayJobList {
  jobs: RelayJob[];
  stats: RelayStats;
}

export interface RelayEnqueueResponse {
  job: RelayJob | null;       // 저장 실패 주입 경로면 null
  duplicate: boolean;
  persisted: boolean;
}

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

/** 모든 예외 응답의 공통 형태 (GlobalExceptionHandler.ErrorResponse) */
export interface ErrorResponse {
  code: string;
  message: string;
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

/** GET /api/ip-rules/match - 규칙(IP/CIDR)이 대상 IP 를 포함하는지 판정 + 정규화 */
export interface IpMatchResponse {
  rule: string;
  target: string;
  normalizedRule: string;
  normalizedTarget: string;
  family: 'IPV4' | 'IPV6';
  matches: boolean;
}

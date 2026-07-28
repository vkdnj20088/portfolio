package com.portfolio.extension.dto;

import java.time.Instant;

/**
 * IP 접근 규칙 응답. 시각은 UTC {@link Instant} 로 직렬화되어(ISO-8601, ...Z)
 * 프론트가 사용자 디바이스 시간대로 렌더한다.
 */
public record IpRuleResponse(
        Long id,
        String ipAddress,
        String description,
        Instant startAt,
        Instant endAt,
        Instant createdAt) {
}

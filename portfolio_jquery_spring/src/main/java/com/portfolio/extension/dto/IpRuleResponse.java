package com.portfolio.extension.dto;

import java.time.Instant;

/**
 * IP 접근 규칙 응답. 시각은 UTC {@link Instant} 로 직렬화되어(ISO-8601, ...Z)
 * 프론트가 접속 기기 시간대로 렌더한다 - 저장은 절대 시점, 표시는 보는 사람 기준이다.
 */
public record IpRuleResponse(
        Long id,
        String ipAddress,
        String description,
        Instant startAt,
        Instant endAt,
        Instant createdAt,
        /** 판정(#G1). ALLOW | DENY - 넓은 허용 안에서 좁은 예외를 파낼 수 있게 한다. */
        String action,
        /** 평가 우선순위(#G1). 작은 값이 먼저 평가되고 첫 매치가 이긴다. */
        int priority) {
}

package com.portfolio.extension.dto;

import java.time.Instant;

/** 감사 로그 한 건. 시각은 ISO-8601 UTC(프론트가 디바이스 TZ 로 렌더). */
public record IpAuditResponse(
        Long id,
        String action,
        Long ruleId,
        String ipAddress,
        String actor,
        Instant createdAt) {
}

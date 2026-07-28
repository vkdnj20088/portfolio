package com.portfolio.extension.dto;

import java.util.List;

/** 감사 로그 목록(키셋 페이지네이션) - 규칙 목록과 동일한 계약. */
public record IpAuditListResponse(
        List<IpAuditResponse> items,
        String nextCursor,
        boolean hasMore) {
}

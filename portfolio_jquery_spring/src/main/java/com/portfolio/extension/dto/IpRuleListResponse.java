package com.portfolio.extension.dto;

import java.util.List;

/**
 * IP 규칙 목록(키셋 페이지네이션). nextCursor 가 있으면 다음 페이지가 존재한다.
 * OFFSET 을 쓰지 않으므로 100만 건에서도 페이지 이동 비용이 일정하다.
 */
public record IpRuleListResponse(
        List<IpRuleResponse> items,
        String nextCursor,
        boolean hasMore) {
}

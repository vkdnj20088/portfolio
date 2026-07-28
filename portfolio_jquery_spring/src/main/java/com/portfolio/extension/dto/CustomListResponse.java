package com.portfolio.extension.dto;

import java.util.List;

/** GET /api/extensions/custom - 목록 + 현재 개수 + 상한(200) */
public record CustomListResponse(List<CustomItemResponse> extensions, long count, long limit) {
}

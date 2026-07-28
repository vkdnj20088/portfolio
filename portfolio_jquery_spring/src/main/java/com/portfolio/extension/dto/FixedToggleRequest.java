package com.portfolio.extension.dto;

import jakarta.validation.constraints.NotNull;

/**
 * PATCH /api/extensions/fixed/{name} 요청 바디.
 *
 * blocked 를 원시 boolean 이 아니라 {@link Boolean} + {@code @NotNull} 로 둔다. 원시형이면
 * 필드 누락(본문 {@code {}})이 조용히 {@code false} 로 바인딩되어, 의도를 밝히지 않은 요청이
 * 보안 확장자를 "해제"하는 안전하지 않은 방향으로 기본값이 잡힌다. null 을 명시적으로 400 으로
 * 거절해 fail-safe 하게 만든다(프론트는 항상 값을 보내므로 직접 호출 경로를 굳힌다).
 */
public record FixedToggleRequest(
        @NotNull(message = "blocked 값을 지정해 주세요.") Boolean blocked) {
}

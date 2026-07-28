package com.portfolio.extension.dto;

/** POST 성공(201) - 생성된 리소스 + 갱신된 개수 */
public record CustomCreatedResponse(Long id, String name, long count) {
}

package com.portfolio.extension.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * POST /api/extensions/custom 요청 바디.
 *
 * <p>여기서는 <b>원시 입력의 기본 계약</b>(빈 값, 길이)만 Bean Validation 으로 선검증한다.
 * 문자 화이트리스트(^[a-z0-9]+$)와 정규화(대소문자/점/공백)는 서비스 책임으로 남긴다 -
 * {@code .exe}/{@code " exe "} 같은 정규화 대상 입력을 DTO 단계에서 미리 거부하지 않기 위함.
 */
public record CustomExtensionRequest(
        @NotBlank(message = "확장자를 입력해 주세요.")
        @Size(max = 20, message = "확장자는 최대 20자까지 입력할 수 있습니다.")
        String name) {
}

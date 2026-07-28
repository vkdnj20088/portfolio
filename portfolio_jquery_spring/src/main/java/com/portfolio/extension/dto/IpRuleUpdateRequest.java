package com.portfolio.extension.dto;

import com.portfolio.extension.dto.validation.ValidIpOrCidr;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;

/**
 * IP 접근 규칙 부분수정(PUT) 요청(#Q2). 접수 검증은 생성과 동일하게(IP/CIDR 형식/설명 20자/기간 정합)
 * 재사용한다 - 수정도 생성만큼 방어적이어야 한다. 낙관적 락(@Version)이 동시 수정 충돌을 409 로 막는다.
 */
public record IpRuleUpdateRequest(
        @NotBlank(message = "IP 주소를 입력해 주세요.")
        @Size(max = 45, message = "IP 주소가 너무 깁니다.")
        @ValidIpOrCidr
        String ipAddress,

        @NotBlank(message = "설명을 입력해 주세요.")
        @Size(max = 20, message = "설명은 최대 20자까지 입력할 수 있습니다.")
        String description,

        @NotNull(message = "사용 시작 시간을 입력해 주세요.")
        Instant startAt,

        @NotNull(message = "사용 끝 시간을 입력해 주세요.")
        Instant endAt) {

    @AssertTrue(message = "사용 끝 시간은 시작 시간보다 같거나 늦어야 합니다.")
    public boolean isValidPeriod() {
        return startAt == null || endAt == null || !endAt.isBefore(startAt);
    }
}

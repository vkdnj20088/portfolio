package com.portfolio.extension.dto;

import com.portfolio.extension.dto.validation.ValidIpOrCidr;
import jakarta.validation.constraints.AssertTrue;
import com.portfolio.extension.domain.IpAccessRule;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;

/**
 * IP 접근 규칙 등록 요청. 원시 계약(빈 값/길이/필수)만 검증하고,
 * 시작 &lt;= 끝 같은 교차 필드 규칙은 아래 {@link #isValidPeriod()} 로 방어한다
 * (초기 예시 데이터가 시작&gt;끝 으로 뒤집혀 있어 의도적으로 막는다).
 * 시각은 프론트가 기기 시간대 벽시계로 해석해 ISO-8601 UTC 문자열로 보낸다(Jackson -&gt; Instant).
 */
public record IpRuleCreateRequest(
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
        Instant endAt,

        /**
         * 판정(#G1). 생략하면 ALLOW - 기존 클라이언트가 이 필드를 모르고 보내도 직전과 같은
         * 의미가 되어야 한다(계약을 넓힐 때 기본값이 곧 하위 호환이다).
         */
        IpAccessRule.Action action,

        /** 평가 우선순위(#G1). 생략하면 100(기본). 작은 값이 먼저 평가된다. */
        @Min(value = 0, message = "우선순위는 0 이상이어야 합니다.")
        @Max(value = 9999, message = "우선순위는 9999 이하여야 합니다.")
        Integer priority) {

    @AssertTrue(message = "사용 끝 시간은 시작 시간보다 같거나 늦어야 합니다.")
    public boolean isValidPeriod() {
        return startAt == null || endAt == null || !endAt.isBefore(startAt);
    }
}

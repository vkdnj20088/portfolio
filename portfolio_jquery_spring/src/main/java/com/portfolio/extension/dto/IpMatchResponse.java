package com.portfolio.extension.dto;

/**
 * "이 규칙(IP/CIDR)이 이 대상 IP 를 포함하는가" 판정 결과.
 * 입력 원문과 함께 정규화(canonical) 표기를 돌려줘 프론트가 흔들린 표기를 교정해 보여줄 수 있다.
 */
public record IpMatchResponse(
        String rule,           // 입력 원문(규칙)
        String target,         // 입력 원문(대상 IP)
        String normalizedRule, // 정규화된 규칙(IPv6 축약/CIDR 마스킹)
        String normalizedTarget,
        String family,         // IPV4 | IPV6
        boolean matches) {
}

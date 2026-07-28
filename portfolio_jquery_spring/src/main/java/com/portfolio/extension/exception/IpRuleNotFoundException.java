package com.portfolio.extension.exception;

/** 존재하지 않는 IP 접근 규칙(삭제 대상 없음 등) -> 404 */
public class IpRuleNotFoundException extends RuntimeException {
    public IpRuleNotFoundException(String message) {
        super(message);
    }
}

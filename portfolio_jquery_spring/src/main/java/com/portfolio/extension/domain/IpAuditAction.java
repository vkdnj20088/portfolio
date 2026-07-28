package com.portfolio.extension.domain;

/** IP 접근 규칙 변경 유형 - 감사 로그에 문자열로 저장한다(스키마 안정성). */
public enum IpAuditAction {
    CREATE,
    UPDATE,
    DELETE
}

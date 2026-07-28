package com.portfolio.extension.exception;

/**
 * IP/CIDR 파싱/판정 계층에서 잘못된 입력을 알린다. GlobalExceptionHandler 가 400(INVALID)로 매핑한다.
 * (create 경로는 @ValidIpOrCidr 로 접수 단계에서 막지만, match 조회처럼 쿼리 파라미터를 직접
 * 파싱하는 지점에서 사유를 담아 던지기 위한 도메인 예외.)
 */
public class InvalidIpException extends RuntimeException {
    public InvalidIpException(String message) {
        super(message);
    }
}

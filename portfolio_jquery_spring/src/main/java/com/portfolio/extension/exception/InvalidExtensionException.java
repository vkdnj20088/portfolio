package com.portfolio.extension.exception;

/** 형식 오류(빈 값 / 허용되지 않는 문자 / 20자 초과) -> 400 */
public class InvalidExtensionException extends RuntimeException {
    public InvalidExtensionException(String message) {
        super(message);
    }
}

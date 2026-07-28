package com.portfolio.extension.exception;

/** 커스텀 확장자 최대 개수(200) 초과 -> 422 */
public class ExtensionLimitExceededException extends RuntimeException {
    public ExtensionLimitExceededException(String message) {
        super(message);
    }
}

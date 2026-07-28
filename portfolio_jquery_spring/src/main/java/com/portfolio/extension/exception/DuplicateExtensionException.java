package com.portfolio.extension.exception;

/** 이미 등록된 확장자(정규화 후 중복 / 고정<->커스텀 교차 중복) -> 409 */
public class DuplicateExtensionException extends RuntimeException {
    public DuplicateExtensionException(String message) {
        super(message);
    }
}

package com.portfolio.extension.exception;

/** 존재하지 않는 확장자 대상 조작 -> 404 */
public class ExtensionNotFoundException extends RuntimeException {
    public ExtensionNotFoundException(String message) {
        super(message);
    }
}

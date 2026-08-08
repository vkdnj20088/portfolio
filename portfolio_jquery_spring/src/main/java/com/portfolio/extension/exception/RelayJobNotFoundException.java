package com.portfolio.extension.exception;

public class RelayJobNotFoundException extends RuntimeException {

    public RelayJobNotFoundException(Long id) {
        super("작업이 없습니다: id=" + id);
    }
}

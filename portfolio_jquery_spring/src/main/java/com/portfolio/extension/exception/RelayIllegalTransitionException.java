package com.portfolio.extension.exception;

import com.portfolio.extension.relay.RelayJobStatus;

/**
 * 정의되지 않은 상태 전이 시도(예: RUNNING 취소, SUCCEEDED 재처리). 클라이언트 상태가
 * 낡았다는 뜻이므로 409 로 거절한다 - 화면은 코드로 문구를 조립하고 목록을 새로고침한다.
 */
public class RelayIllegalTransitionException extends RuntimeException {

    private final RelayJobStatus current;

    public RelayIllegalTransitionException(String action, RelayJobStatus current) {
        super(action + " 불가: 현재 상태 " + current);
        this.current = current;
    }

    public RelayJobStatus getCurrent() {
        return current;
    }
}

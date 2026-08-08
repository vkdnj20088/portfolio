package com.portfolio.extension.relay;

/**
 * 작업 상태. DB·API·화면이 같은 enum 을 쓰고 표시 문자열만 클라이언트가 갈아 끼운다.
 *
 * <p>{@code RETRYING} 을 {@code PENDING} 의 별칭으로 접지 않고 명시 상태로 둔다 - 화면이
 * "첫 시도 대기"와 "재시도 대기"를 다르게 말해야 하는데, DB 와 화면이 다른 어휘를 쓰면
 * 나중에 어긋난다. 종단 상태는 SUCCEEDED·CANCELED, DEAD_LETTER 는 준종단(수동 재처리로만
 * 복귀)이다.
 */
public enum RelayJobStatus {
    /** 첫 시도 대기. */
    PENDING,
    /** 워커가 리스를 잡고 실행 중. */
    RUNNING,
    /** 실패 후 다음 시도 대기(next_attempt_at 도래 시 워커가 집는다). */
    RETRYING,
    /** 성공 종료(종단). */
    SUCCEEDED,
    /** 시도 소진으로 격리(준종단 - 수동 재처리로만 복귀). */
    DEAD_LETTER,
    /** 사용자 취소(종단). */
    CANCELED;

    /** 워커가 집을 수 있는 상태인가(리스 후보). */
    public boolean runnable() {
        return this == PENDING || this == RETRYING;
    }

    /** 더 이상 스스로 움직이지 않는 상태인가(종단 + 준종단). */
    public boolean terminal() {
        return this == SUCCEEDED || this == CANCELED || this == DEAD_LETTER;
    }
}

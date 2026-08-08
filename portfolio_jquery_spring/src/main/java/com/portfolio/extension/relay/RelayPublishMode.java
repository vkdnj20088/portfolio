package com.portfolio.extension.relay;

/**
 * 예약 이벤트 발행 모드 - 아웃박스 비교 데모의 스위치.
 *
 * <ul>
 *   <li>{@link #OUTBOX}: 이벤트를 원본과 같은 트랜잭션으로 적재, 발행기가 커밋 후 발행.
 *       저장이 구르면 이벤트도 함께 구른다(유령 0).</li>
 *   <li>{@link #DIRECT}: 이벤트를 트랜잭션 밖에서 즉시 발행. 저장이 구르면 원본은 없는데
 *       이벤트만 나간다 - 유령 이벤트 카운터가 오른다. 안티패턴을 보여주기 위해 존재한다.</li>
 * </ul>
 */
public enum RelayPublishMode {
    OUTBOX,
    DIRECT
}

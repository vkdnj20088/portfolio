package com.portfolio.extension.service;

/**
 * 차단 목록(고정 blocked / 커스텀)이 변경됐음을 알리는 도메인 이벤트.
 *
 * <p>발행은 변경 트랜잭션 "안"에서 이루어지고, 실제 캐시 무효화는 커밋 "후"에만 실행된다
 * ({@link BlocklistCacheEvictor}). 이렇게 분리해야 캐시가 커밋 전 스냅샷으로 다시 채워지는
 * 창(stale window)이 생기지 않는다.
 */
public record BlocklistChangedEvent() {
}

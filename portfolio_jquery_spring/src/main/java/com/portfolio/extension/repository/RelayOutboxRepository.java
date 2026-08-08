package com.portfolio.extension.repository;

import com.portfolio.extension.domain.RelayOutboxEvent;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface RelayOutboxRepository extends JpaRepository<RelayOutboxEvent, Long> {

    /** 발행기 배치 - 커밋된 미발행 이벤트를 오래된 것부터. */
    @Query(value = "SELECT * FROM relay_outbox WHERE published_at IS NULL "
            + "ORDER BY id LIMIT :limit", nativeQuery = true)
    List<RelayOutboxEvent> findUnpublished(@Param("limit") int limit);

    long countByPublishedAtIsNull();

    /**
     * 유령 이벤트 수 - <b>발행은 됐는데 원본(relay_job)이 없는</b> 이벤트. 직접 발행 모드에서
     * 저장 트랜잭션이 구르면 여기 잡힌다. 아웃박스 모드에서는 적재가 같은 트랜잭션이라
     * 원리적으로 0 이다. 이 숫자 하나가 두 모드의 차이를 설명 없이 전달한다.
     */
    @Query(value = "SELECT COUNT(*) FROM relay_outbox o "
            + "LEFT JOIN relay_job j ON j.idempotency_key = o.aggregate_key "
            + "WHERE o.published_at IS NOT NULL AND j.id IS NULL", nativeQuery = true)
    long countGhostEvents();
}

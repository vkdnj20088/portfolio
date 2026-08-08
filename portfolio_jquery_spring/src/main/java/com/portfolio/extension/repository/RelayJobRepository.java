package com.portfolio.extension.repository;

import com.portfolio.extension.domain.RelayJob;
import com.portfolio.extension.relay.RelayJobStatus;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface RelayJobRepository extends JpaRepository<RelayJob, Long> {

    Optional<RelayJob> findByIdempotencyKey(String idempotencyKey);

    /**
     * 워커 리스 - <b>{@code FOR UPDATE SKIP LOCKED}</b>. 잠긴 행은 기다리지 않고 건너뛰므로
     * 워커 여럿이 같은 작업을 두 번 집지 않으면서 서로를 막지도 않는다(큐의 정석).
     *
     * <p>기존 {@code DistributedLock}(GET_LOCK)을 쓰지 않는 이유는 이미 저장소에 문서화돼
     * 있다 - GET_LOCK 은 대기자마다 커넥션을 점유해 팬인이 크면 풀이 마른다. 행 단위 리스에는
     * SKIP LOCKED 가 맞다. H2(MySQL 모드)도 같은 구문을 지원해 로컬 무설정 실행이 유지된다.
     *
     * <p>리스 트랜잭션 안에서 호출해 행 잠금을 잡고, RUNNING 전이 후 바로 커밋한다(짧은 리스).
     */
    @Query(value = "SELECT * FROM relay_job WHERE status IN ('PENDING', 'RETRYING') "
            + "AND next_attempt_at <= :now ORDER BY next_attempt_at, id "
            + "LIMIT :limit FOR UPDATE SKIP LOCKED", nativeQuery = true)
    List<RelayJob> leaseReady(@Param("now") Instant now, @Param("limit") int limit);

    /** 큐 현황 - 상태별 건수(화면 상단 카운터). */
    long countByStatus(RelayJobStatus status);

    /** 실행 대기 중 가장 이른 예정 시각 - 적응형 폴러가 유휴 주기를 정할 때 쓴다. */
    @Query(value = "SELECT MIN(next_attempt_at) FROM relay_job "
            + "WHERE status IN ('PENDING', 'RETRYING')", nativeQuery = true)
    Instant earliestNextAttempt();

    List<RelayJob> findTop20ByOrderByCreatedAtDescIdDesc();

    List<RelayJob> findTop20ByStatusOrderByUpdatedAtDescIdDesc(RelayJobStatus status);
}

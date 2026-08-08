package com.portfolio.extension.domain;

import com.portfolio.extension.relay.RelayJobStatus;
import com.portfolio.extension.relay.RelayJobType;
import com.portfolio.extension.relay.RelayScenario;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

/**
 * 재시도 파이프라인의 작업 한 건. "실패하는 작업을 잃지도 않고, 무한히 붙잡지도 않는다"의
 * 주어다. 성패는 저장된 (seed, idempotencyKey, scenario) 에서 파생되는 순수 함수라
 * (RelayOutcomes), 같은 작업은 언제 다시 돌려도 같은 타임라인을 낸다.
 *
 * <p>멱등 키는 UNIQUE 다. 같은 키의 재예약은 오류가 아니라 <b>기존 작업을 그대로 돌려주는
 * 200</b> 이다(재시도 안전) - 마지막 방어선은 애플리케이션 검사가 아니라 이 제약이다.
 */
@Entity
@Table(name = "relay_job")
public class RelayJob {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "idempotency_key", nullable = false, unique = true, length = 64)
    private String idempotencyKey;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private RelayJobType type;

    /** 데모 페이로드 요약(자유 텍스트). 실행 로직은 이 값을 해석하지 않는다. */
    @Column(length = 255)
    private String payload;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private RelayJobStatus status;

    @Column(name = "attempt_count", nullable = false)
    private int attemptCount;

    @Column(name = "max_attempts", nullable = false)
    private int maxAttempts;

    /** 결정적 실패 주입 시드 - 화면에 노출되고 쿼리스트링으로 재생된다. */
    @Column(nullable = false)
    private int seed;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private RelayScenario scenario;

    /**
     * 재처리 세대(0부터). 시도 이력은 append-only 인데 재처리가 시도 번호를 1부터 다시 쓰므로,
     * 세대를 올려 UNIQUE(job_id, run, attempt_no) 를 지킨다. 부수 효과로 세대별 타임라인이
     * 나란히 남아 "같은 시드는 같은 타임라인"(결정성)이 화면에서 눈으로 증명된다.
     */
    @Column(name = "run", nullable = false)
    private int run;

    /** 다음 시도 시각(UTC). PENDING/RETRYING 에서만 의미가 있다. */
    @Column(name = "next_attempt_at")
    private Instant nextAttemptAt;

    /**
     * 예약 요청의 상관 ID. HTTP 필터의 MDC 는 비동기 경계에서 끊기므로, 워커가 실행할 때
     * 이 값을 복원해 "예약 → 실행" 로그가 같은 식별자로 이어지게 한다.
     */
    @Column(name = "enqueue_cid", length = 64)
    private String enqueueCid;

    /** 낙관적 락 - 워커 리스와 사용자 취소/재처리가 같은 행을 두고 경합할 때 감지·거절. */
    @Version
    @Column(nullable = false)
    private long version;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected RelayJob() {
    }

    public RelayJob(String idempotencyKey, RelayJobType type, String payload, RelayScenario scenario,
            int seed, int maxAttempts, Instant firstAttemptAt, String enqueueCid) {
        this.idempotencyKey = idempotencyKey;
        this.type = type;
        this.payload = payload;
        this.scenario = scenario;
        this.seed = seed;
        this.maxAttempts = maxAttempts;
        this.status = RelayJobStatus.PENDING;
        this.attemptCount = 0;
        this.nextAttemptAt = firstAttemptAt;
        this.enqueueCid = enqueueCid;
    }

    // ── 상태 전이 - 정의된 간선으로만 움직인다(전이 폐쇄성은 jqwik 속성이 지킨다) ──

    /** PENDING|RETRYING → RUNNING. 워커가 리스를 잡은 직후. */
    public void markRunning() {
        requireStatus(status.runnable(), "RUNNING 전이는 PENDING/RETRYING 에서만");
        this.status = RelayJobStatus.RUNNING;
    }

    /** RUNNING → SUCCEEDED(종단). */
    public void markSucceeded() {
        requireStatus(status == RelayJobStatus.RUNNING, "SUCCEEDED 전이는 RUNNING 에서만");
        this.status = RelayJobStatus.SUCCEEDED;
        this.nextAttemptAt = null;
    }

    /** RUNNING → RETRYING. 실패했고 남은 시도가 있다. */
    public void markRetrying(Instant nextAttemptAt) {
        requireStatus(status == RelayJobStatus.RUNNING, "RETRYING 전이는 RUNNING 에서만");
        this.status = RelayJobStatus.RETRYING;
        this.nextAttemptAt = nextAttemptAt;
    }

    /** RUNNING → DEAD_LETTER(준종단). 시도 소진. */
    public void markDeadLetter() {
        requireStatus(status == RelayJobStatus.RUNNING, "DEAD_LETTER 전이는 RUNNING 에서만");
        this.status = RelayJobStatus.DEAD_LETTER;
        this.nextAttemptAt = null;
    }

    /** PENDING|RETRYING → CANCELED(종단). 실행 중(RUNNING)은 취소 불가. */
    public void markCanceled() {
        requireStatus(status.runnable(), "CANCELED 전이는 PENDING/RETRYING 에서만");
        this.status = RelayJobStatus.CANCELED;
        this.nextAttemptAt = null;
    }

    /**
     * DEAD_LETTER → PENDING. 수동 재처리 - 시도 카운터를 재설정하되 멱등 키는 그대로라
     * 재처리가 중복 실행을 만들지 않는다.
     */
    public void reprocess(Instant nextAttemptAt) {
        requireStatus(status == RelayJobStatus.DEAD_LETTER, "재처리는 DEAD_LETTER 에서만");
        this.status = RelayJobStatus.PENDING;
        this.attemptCount = 0;
        this.run++;
        this.nextAttemptAt = nextAttemptAt;
    }

    public void incrementAttemptCount() {
        this.attemptCount++;
    }

    private void requireStatus(boolean ok, String message) {
        if (!ok) {
            throw new IllegalStateException(message + " (현재 " + status + ")");
        }
    }

    public Long getId() {
        return id;
    }

    public String getIdempotencyKey() {
        return idempotencyKey;
    }

    public RelayJobType getType() {
        return type;
    }

    public String getPayload() {
        return payload;
    }

    public RelayJobStatus getStatus() {
        return status;
    }

    public int getAttemptCount() {
        return attemptCount;
    }

    public int getMaxAttempts() {
        return maxAttempts;
    }

    public int getSeed() {
        return seed;
    }

    public int getRun() {
        return run;
    }

    public RelayScenario getScenario() {
        return scenario;
    }

    public Instant getNextAttemptAt() {
        return nextAttemptAt;
    }

    public String getEnqueueCid() {
        return enqueueCid;
    }

    public long getVersion() {
        return version;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}

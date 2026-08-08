package com.portfolio.extension.domain;

import com.portfolio.extension.relay.RelayErrorCode;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import java.time.Instant;

/**
 * 시도 이력 한 줄 - 화면 타임라인의 원천. append-only 다(IP 감사 로그와 같은 원칙:
 * 이력은 수정하지 않는다). UNIQUE(job_id, run, attempt_no) 가 "같은 시도 번호가 두 번
 * 기록되는" 워커 중복 실행을 DB 차원에서 거절한다 - SKIP LOCKED 가 뚫려도 이력은 안 겹친다.
 * run 은 재처리 세대다 - 재처리가 시도 번호를 1부터 다시 쓰므로 세대로 구분한다.
 */
@Entity
@Table(name = "relay_attempt",
        uniqueConstraints = @UniqueConstraint(name = "uq_relay_attempt", columnNames = {"job_id", "run", "attempt_no"}))
public class RelayAttempt {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "job_id", nullable = false)
    private Long jobId;

    @Column(name = "run", nullable = false)
    private int run;

    @Column(name = "attempt_no", nullable = false)
    private int attemptNo;

    @Column(name = "started_at", nullable = false)
    private Instant startedAt;

    @Column(name = "finished_at", nullable = false)
    private Instant finishedAt;

    @Column(nullable = false)
    private boolean success;

    @Enumerated(EnumType.STRING)
    @Column(name = "error_code", length = 32)
    private RelayErrorCode errorCode;

    /** 실패 시 다음 시도까지의 대기(ms). 성공이면 0. 화면이 산식과 함께 표시한다. */
    @Column(name = "backoff_ms", nullable = false)
    private long backoffMs;

    /** 이 시도를 실행한 워커의 상관 ID - 로그와 화면이 같은 식별자로 만난다. */
    @Column(length = 64)
    private String cid;

    protected RelayAttempt() {
    }

    public RelayAttempt(Long jobId, int run, int attemptNo, Instant startedAt, Instant finishedAt,
            boolean success, RelayErrorCode errorCode, long backoffMs, String cid) {
        this.jobId = jobId;
        this.run = run;
        this.attemptNo = attemptNo;
        this.startedAt = startedAt;
        this.finishedAt = finishedAt;
        this.success = success;
        this.errorCode = errorCode;
        this.backoffMs = backoffMs;
        this.cid = cid;
    }

    public Long getId() {
        return id;
    }

    public Long getJobId() {
        return jobId;
    }

    public int getRun() {
        return run;
    }

    public int getAttemptNo() {
        return attemptNo;
    }

    public Instant getStartedAt() {
        return startedAt;
    }

    public Instant getFinishedAt() {
        return finishedAt;
    }

    public boolean isSuccess() {
        return success;
    }

    public RelayErrorCode getErrorCode() {
        return errorCode;
    }

    public long getBackoffMs() {
        return backoffMs;
    }

    public String getCid() {
        return cid;
    }
}

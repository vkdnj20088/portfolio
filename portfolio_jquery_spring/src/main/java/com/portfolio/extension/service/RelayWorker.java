package com.portfolio.extension.service;

import com.portfolio.extension.config.CorrelationIdFilter;
import com.portfolio.extension.domain.RelayAttempt;
import com.portfolio.extension.domain.RelayJob;
import com.portfolio.extension.domain.RelayOutboxEvent;
import com.portfolio.extension.observability.RelayMetrics;
import com.portfolio.extension.relay.RelayJobStatus;
import com.portfolio.extension.relay.RelayOutcomes;
import com.portfolio.extension.repository.RelayAttemptRepository;
import com.portfolio.extension.repository.RelayJobRepository;
import com.portfolio.extension.repository.RelayOutboxRepository;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 큐 워커 - 준비된 작업을 리스(lease)해 실행한다. 실행은 외부 호출이 아니라
 * {@link RelayOutcomes} 의 결정적 시뮬레이션이다(§0).
 *
 * <p><b>리스</b>: {@code SELECT ... FOR UPDATE SKIP LOCKED} + RUNNING 전이 + 즉시 커밋(짧은
 * 리스 트랜잭션). 잠긴 행을 건너뛰므로 워커 여럿이 같은 작업을 두 번 집지 않는다 - 이 성질은
 * Testcontainers IT 가 실제 MySQL 로 실증하고, 운영 배포는 단일 인스턴스라 워커 1개만 쓴다
 * (안 쓰는 능력을 켜 두지 않는다 - README).
 *
 * <p><b>폴링</b>: 1초 고정이 아니라 적응형이다. 집을 것이 없으면 다음 예정 시각(또는 유휴
 * 상한)까지 폴을 쉬고, 예약·재처리가 {@link #wake()} 로 즉시 깨운다. 유휴 CPU 를 먹지 않으면서
 * 반응성을 잃지 않는 절충이다.
 *
 * <p><b>상관 ID</b>: HTTP 필터의 MDC 는 비동기 경계에서 끊긴다. 실행 시 예약 요청의 cid 를
 * MDC 에 복원하고, 시도 자체에는 워커가 발급한 cid 를 새로 부여해(부모-자식) 타임라인
 * 각 행이 로그와 같은 식별자로 만나게 한다.
 */
@Component
public class RelayWorker {

    private static final Logger log = LoggerFactory.getLogger(RelayWorker.class);

    /** 한 틱에 집는 최대 작업 수 - 무한 대기열을 만들지 않는 상한(벌크헤드와 같은 원칙). */
    static final int LEASE_BATCH = 4;
    /** 유휴 시 폴 간격 상한. */
    static final long MAX_IDLE_MS = 5_000L;

    private final RelayJobRepository jobs;
    private final RelayAttemptRepository attempts;
    private final RelayOutboxRepository outbox;
    private final RelayMetrics metrics;
    private final TransactionTemplate tx;
    private final boolean enabled;

    /** 다음 폴 시각(적응형). wake() 가 과거로 당겨 즉시 폴하게 만든다. */
    private volatile Instant nextPollAt = Instant.EPOCH;

    public RelayWorker(RelayJobRepository jobs, RelayAttemptRepository attempts,
            RelayOutboxRepository outbox, RelayMetrics metrics,
            PlatformTransactionManager transactionManager,
            @Value("${app.relay.worker.enabled:true}") boolean enabled) {
        this.jobs = jobs;
        this.attempts = attempts;
        this.outbox = outbox;
        this.metrics = metrics;
        this.tx = new TransactionTemplate(transactionManager);
        this.enabled = enabled;
    }

    /** 예약·재처리 직후 호출 - 다음 틱에서 바로 폴한다. */
    public void wake() {
        nextPollAt = Instant.EPOCH;
    }

    @Scheduled(fixedDelayString = "${app.relay.worker.tick-ms:500}")
    public void tick() {
        if (!enabled) {
            return;
        }
        Instant now = Instant.now();
        if (now.isBefore(nextPollAt)) {
            return; // 유휴 감속 중 - wake() 가 당기기 전까지 폴하지 않는다
        }

        List<Long> leased;
        try {
            leased = tx.execute(status -> {
                List<RelayJob> ready = jobs.leaseReady(now, LEASE_BATCH);
                for (RelayJob job : ready) {
                    job.markRunning();
                }
                return ready.stream().map(RelayJob::getId).toList();
            });
        } catch (OptimisticLockingFailureException e) {
            // 취소/재처리와 리스가 같은 행에서 스쳤다 - 이번 틱을 접고 다음 틱이 다시 본다.
            log.debug("relay lease conflict, retry next tick", e);
            return;
        }

        if (leased.isEmpty()) {
            // 다음 예정 시각까지(없으면 유휴 상한) 폴을 쉰다.
            Instant earliest = jobs.earliestNextAttempt();
            Instant cap = now.plusMillis(MAX_IDLE_MS);
            nextPollAt = (earliest == null || earliest.isAfter(cap)) ? cap
                    : (earliest.isBefore(now) ? now : earliest);
            return;
        }

        nextPollAt = now; // 활동 중 - 다음 틱도 바로 폴
        for (Long id : leased) {
            executeAttempt(id);
        }
    }

    /** 리스된 작업 하나의 시도 1회 - 이력 기록·상태 전이·완료 이벤트가 한 트랜잭션이다. */
    private void executeAttempt(Long jobId) {
        long startNanos = System.nanoTime();
        boolean[] success = {false};
        try {
            tx.executeWithoutResult(status -> {
                RelayJob job = jobs.findById(jobId).orElse(null);
                if (job == null || job.getStatus() != RelayJobStatus.RUNNING) {
                    return; // 리스와 실행 사이에 상태가 바뀌었다면 이번 실행은 무효
                }
                String enqueueCid = job.getEnqueueCid();
                String attemptCid = UUID.randomUUID().toString().substring(0, 8);
                // 예약 cid 를 복원해 "예약 → 실행" 로그가 이어지게 하고, 시도에는 자식 cid 를 부여한다.
                MDC.put(CorrelationIdFilter.MDC_KEY, enqueueCid != null ? enqueueCid : attemptCid);
                try {
                    int attemptNo = job.getAttemptCount() + 1;
                    RelayOutcomes.AttemptPlan plan = RelayOutcomes.plan(
                            job.getSeed(), job.getScenario(), attemptNo);
                    Instant now = Instant.now();
                    attempts.save(new RelayAttempt(job.getId(), job.getRun(), attemptNo, now, now,
                            plan.success(), plan.errorCode(), plan.backoffMs(), attemptCid));
                    job.incrementAttemptCount();

                    if (plan.success()) {
                        job.markSucceeded();
                        outbox.save(RelayOutboxEvent.pending(job.getIdempotencyKey(),
                                RelayOutboxEvent.TYPE_FINISHED, "SUCCEEDED"));
                        metrics.jobSucceeded();
                        success[0] = true;
                        log.info("relay attempt ok: job={} attempt={} cid={}",
                                job.getId(), attemptNo, attemptCid);
                    } else if (attemptNo >= job.getMaxAttempts()) {
                        job.markDeadLetter();
                        outbox.save(RelayOutboxEvent.pending(job.getIdempotencyKey(),
                                RelayOutboxEvent.TYPE_FINISHED, "DEAD_LETTER"));
                        metrics.jobDeadLettered();
                        log.warn("relay job dead-lettered: job={} attempts={} lastError={} cid={}",
                                job.getId(), attemptNo, plan.errorCode(), attemptCid);
                    } else {
                        job.markRetrying(now.plusMillis(plan.backoffMs()));
                        log.info("relay attempt failed: job={} attempt={} error={} nextIn={}ms cid={}",
                                job.getId(), attemptNo, plan.errorCode(), plan.backoffMs(), attemptCid);
                    }
                } finally {
                    MDC.remove(CorrelationIdFilter.MDC_KEY);
                }
            });
            metrics.attemptExecuted(success[0], System.nanoTime() - startNanos);
        } catch (OptimisticLockingFailureException e) {
            log.debug("relay attempt conflict: job={}", jobId, e);
        }
    }
}

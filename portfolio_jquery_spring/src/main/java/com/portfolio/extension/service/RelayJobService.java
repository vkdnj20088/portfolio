package com.portfolio.extension.service;

import com.portfolio.extension.config.CorrelationIdFilter;
import com.portfolio.extension.domain.RelayJob;
import com.portfolio.extension.domain.RelayOutboxEvent;
import com.portfolio.extension.exception.RelayIllegalTransitionException;
import com.portfolio.extension.exception.RelayJobNotFoundException;
import com.portfolio.extension.observability.RelayMetrics;
import com.portfolio.extension.relay.RelayJobStatus;
import com.portfolio.extension.relay.RelayJobType;
import com.portfolio.extension.relay.RelayPublishMode;
import com.portfolio.extension.relay.RelayScenario;
import com.portfolio.extension.repository.RelayJobRepository;
import com.portfolio.extension.repository.RelayOutboxRepository;
import jakarta.annotation.PostConstruct;
import java.time.Instant;
import java.util.EnumMap;
import java.util.Map;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 작업 예약·취소·재처리. 워커(RelayWorker)와 발행기(RelayOutboxPublisher)는 별도 컴포넌트다.
 *
 * <p>멱등 예약의 층은 둘이다: 애플리케이션 검사(findByIdempotencyKey)가 평상시 경로,
 * DB UNIQUE 가 동시 요청이 검사를 동시에 통과했을 때의 마지막 방어선이다. UNIQUE 충돌은
 * 오류가 아니라 "이미 있는 작업"으로 접어 돌려준다(재시도 안전 - 같은 키의 재요청은
 * 몇 번을 보내도 실행 1건).
 *
 * <p>트랜잭션은 {@link TransactionTemplate}(프로그래매틱)이다. 커스텀 확장자 200 경계와
 * 같은 이유(자기호출 프록시 우회 회피)에 더해, 여기서는 "저장 실패 주입 + 직접 발행"이
 * 트랜잭션 경계 <b>밖</b> 발행을 요구하므로 경계가 코드에 보이는 편이 낫다.
 */
@Service
public class RelayJobService {

    private static final Logger log = LoggerFactory.getLogger(RelayJobService.class);

    /** 예약 직후 첫 시도까지의 지연 - 화면이 "대기 → 실행" 전이를 눈으로 따라갈 시간. */
    static final long FIRST_ATTEMPT_DELAY_MS = 1_000L;

    private final RelayJobRepository jobs;
    private final RelayOutboxRepository outbox;
    private final RelayMetrics metrics;
    private final RelayWorker worker;
    private final TransactionTemplate tx;
    private final TransactionTemplate txRequiresNew;

    public RelayJobService(RelayJobRepository jobs, RelayOutboxRepository outbox,
            RelayMetrics metrics, RelayWorker worker, PlatformTransactionManager transactionManager) {
        this.jobs = jobs;
        this.outbox = outbox;
        this.metrics = metrics;
        this.worker = worker;
        this.tx = new TransactionTemplate(transactionManager);
        this.txRequiresNew = new TransactionTemplate(transactionManager);
        this.txRequiresNew.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    @PostConstruct
    void registerGauges() {
        for (RelayJobStatus s : RelayJobStatus.values()) {
            metrics.registerQueueDepth(s.name().toLowerCase(), () -> jobs.countByStatus(s));
        }
        metrics.registerOutboxPending(outbox::countByPublishedAtIsNull);
        metrics.registerGhostEvents(outbox::countGhostEvents);
    }

    /** 예약 결과 - duplicate 면 job 은 기존 작업이다. persisted=false 는 저장 실패 주입 경로. */
    public record EnqueueResult(RelayJob job, boolean duplicate, boolean persisted) {
    }

    /**
     * 작업 예약. {@code failPersist} 는 아웃박스 비교 데모의 "저장 실패 주입" - 이벤트 처리
     * 후 저장 트랜잭션을 강제로 굴린다. 두 모드의 차이는 유령 이벤트 카운터가 말한다.
     */
    public EnqueueResult enqueue(String idempotencyKey, RelayJobType type, String payload,
            RelayScenario scenario, int seed, int maxAttempts,
            RelayPublishMode publishMode, boolean failPersist) {

        // 직접 발행 모드: 이벤트가 저장 트랜잭션과 무관하게 먼저 나간다. REQUIRES_NEW 로
        // 별도 커밋해 "저장이 굴러도 이벤트는 남는" 안티패턴을 그대로 재현한다.
        if (publishMode == RelayPublishMode.DIRECT) {
            txRequiresNew.executeWithoutResult(status -> outbox.save(
                    RelayOutboxEvent.publishedNow(idempotencyKey, RelayOutboxEvent.TYPE_ENQUEUED, payload)));
        }

        try {
            EnqueueResult result = tx.execute(status -> {
                Optional<RelayJob> existing = jobs.findByIdempotencyKey(idempotencyKey);
                if (existing.isPresent()) {
                    metrics.duplicateSuppressed();
                    return new EnqueueResult(existing.get(), true, true);
                }
                RelayJob job = jobs.save(new RelayJob(idempotencyKey, type, payload, scenario, seed,
                        maxAttempts, Instant.now().plusMillis(FIRST_ATTEMPT_DELAY_MS),
                        MDC.get(CorrelationIdFilter.MDC_KEY)));
                if (publishMode == RelayPublishMode.OUTBOX) {
                    // 원본과 같은 트랜잭션 - 저장이 구르면 이벤트도 함께 구른다.
                    outbox.save(RelayOutboxEvent.pending(
                            idempotencyKey, RelayOutboxEvent.TYPE_ENQUEUED, payload));
                }
                if (failPersist) {
                    status.setRollbackOnly();
                    return new EnqueueResult(job, false, false);
                }
                return new EnqueueResult(job, false, true);
            });
            if (result.persisted() && !result.duplicate()) {
                metrics.jobEnqueued();
                worker.wake(); // 예약 즉시 폴러를 깨운다 - 유휴 감속과 반응성의 절충
            }
            return result;
        } catch (DataIntegrityViolationException e) {
            // 동시 요청이 존재 검사를 함께 통과한 경우 - UNIQUE 가 접었다. 오류가 아니라 기존 작업 반환.
            metrics.duplicateSuppressed();
            RelayJob existing = jobs.findByIdempotencyKey(idempotencyKey)
                    .orElseThrow(() -> e);
            return new EnqueueResult(existing, true, true);
        }
    }

    /** PENDING/RETRYING 작업 취소. RUNNING 은 취소 불가(이미 실행 중) - 409. */
    public RelayJob cancel(Long id) {
        RelayJob job = tx.execute(status -> {
            RelayJob j = jobs.findById(id).orElseThrow(() -> new RelayJobNotFoundException(id));
            if (!j.getStatus().runnable()) {
                throw new RelayIllegalTransitionException("취소", j.getStatus());
            }
            j.markCanceled();
            return j;
        });
        metrics.jobCanceled();
        log.info("relay job canceled: id={} key={}", job.getId(), job.getIdempotencyKey());
        return job;
    }

    /**
     * DLQ 수동 재처리. 멱등 키가 그대로라 재처리가 중복 실행을 만들지 않는다 - 같은 작업이
     * 같은 시드로 다시 도는 것뿐이다(결정적이라 타임라인도 같다).
     */
    public RelayJob reprocess(Long id) {
        RelayJob job = tx.execute(status -> {
            RelayJob j = jobs.findById(id).orElseThrow(() -> new RelayJobNotFoundException(id));
            if (j.getStatus() != RelayJobStatus.DEAD_LETTER) {
                throw new RelayIllegalTransitionException("재처리", j.getStatus());
            }
            j.reprocess(Instant.now().plusMillis(FIRST_ATTEMPT_DELAY_MS));
            return j;
        });
        worker.wake();
        log.info("relay job reprocess: id={} key={}", job.getId(), job.getIdempotencyKey());
        return job;
    }

    /** 큐 현황 - 상태별 건수 + 아웃박스 지표. */
    public record QueueStats(Map<RelayJobStatus, Long> byStatus, long outboxPending, long ghostEvents) {
    }

    public QueueStats stats() {
        Map<RelayJobStatus, Long> byStatus = new EnumMap<>(RelayJobStatus.class);
        for (RelayJobStatus s : RelayJobStatus.values()) {
            byStatus.put(s, jobs.countByStatus(s));
        }
        return new QueueStats(byStatus, outbox.countByPublishedAtIsNull(), outbox.countGhostEvents());
    }
}

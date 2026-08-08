package com.portfolio.extension.observability;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import org.springframework.stereotype.Component;

/**
 * 재시도 파이프라인 메트릭 - {@link IpMetrics}/{@link FileValidationMetrics} 와 같은 형태
 * (계량기를 컴포넌트 하나에 모으고, 계량 지점은 레지스트리 구현에 의존하지 않는다).
 *
 * <p>기존 관측성 대칭 서사의 다음 단계다: 지금까지는 같은 표준을 옆 모듈로 이식했고,
 * 이번은 동기(요청-응답)에서 <b>비동기(워커)</b>로 넓힌다. 게이지(큐 깊이·미발행·유령)는
 * 서비스가 등록 시점에 공급자로 배선한다.
 */
@Component
public class RelayMetrics {

    private final MeterRegistry registry;
    private final Counter enqueued;
    private final Counter duplicateSuppressed;
    private final Counter completedSucceeded;
    private final Counter completedDeadLetter;
    private final Counter completedCanceled;
    private final Counter attemptSucceeded;
    private final Counter attemptFailed;
    private final Timer attemptTimer;

    public RelayMetrics(MeterRegistry registry) {
        this.registry = registry;
        this.enqueued = Counter.builder("relay.job.enqueued")
                .description("예약된 작업 수").register(registry);
        this.duplicateSuppressed = Counter.builder("relay.duplicate.suppressed")
                .description("멱등 키로 접힌 중복 예약 수").register(registry);
        this.completedSucceeded = Counter.builder("relay.job.completed")
                .tag("result", "succeeded").description("종결된 작업 수").register(registry);
        this.completedDeadLetter = Counter.builder("relay.job.completed")
                .tag("result", "dead_letter").description("종결된 작업 수").register(registry);
        this.completedCanceled = Counter.builder("relay.job.completed")
                .tag("result", "canceled").description("종결된 작업 수").register(registry);
        this.attemptSucceeded = Counter.builder("relay.attempt.executed")
                .tag("outcome", "succeeded").description("실행된 시도 수").register(registry);
        this.attemptFailed = Counter.builder("relay.attempt.executed")
                .tag("outcome", "failed").description("실행된 시도 수").register(registry);
        this.attemptTimer = Timer.builder("relay.attempt.duration")
                .description("시도 실행 소요 시간").register(registry);
    }

    /** 큐 깊이 게이지 - 상태별 공급자를 서비스가 배선한다(호출 시점 조회). */
    public void registerQueueDepth(String state, Supplier<Number> supplier) {
        Gauge.builder("relay.queue.depth", supplier::get)
                .tag("state", state)
                .description("상태별 작업 수").register(registry);
    }

    public void registerOutboxPending(Supplier<Number> supplier) {
        Gauge.builder("relay.outbox.pending", supplier::get)
                .description("미발행 아웃박스 이벤트 수").register(registry);
    }

    public void registerGhostEvents(Supplier<Number> supplier) {
        Gauge.builder("relay.outbox.ghost", supplier::get)
                .description("원본 없이 발행된 유령 이벤트 수(직접 발행 모드의 비용)").register(registry);
    }

    public void jobEnqueued() {
        enqueued.increment();
    }

    public void duplicateSuppressed() {
        duplicateSuppressed.increment();
    }

    public void jobSucceeded() {
        completedSucceeded.increment();
    }

    public void jobDeadLettered() {
        completedDeadLetter.increment();
    }

    public void jobCanceled() {
        completedCanceled.increment();
    }

    /** 시도 결과 + 소요 시간을 한 번에 기록. */
    public void attemptExecuted(boolean success, long nanos) {
        (success ? attemptSucceeded : attemptFailed).increment();
        attemptTimer.record(nanos, TimeUnit.NANOSECONDS);
    }
}

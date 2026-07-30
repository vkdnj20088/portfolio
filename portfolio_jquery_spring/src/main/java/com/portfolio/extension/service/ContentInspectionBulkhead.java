package com.portfolio.extension.service;

import com.portfolio.extension.exception.ValidationCapacityException;
import com.portfolio.extension.observability.FileValidationMetrics;
import jakarta.annotation.PreDestroy;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Future;
import java.util.concurrent.Semaphore;
import java.util.concurrent.SynchronousQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicInteger;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * 콘텐츠 판별(Tika · 아카이브 스캔)을 <b>격리해서</b> 실행한다 - 벌크헤드 + 타임아웃.
 *
 * <h2>왜 필요한가</h2>
 * 확장자 검사는 문자열 비교라 상수 시간이지만, 내용 검사는 다르다. Tika 매직 판별과 zip/ar 멤버
 * 스캔은 <b>CPU 바운드</b>이고 입력이 적대적일 때(중첩 컨테이너, 압축폭탄, 거대 엔트리 헤더)
 * 시간과 메모리를 함께 먹는다. 엔트리 상한({@code MAX_ARCHIVE_ENTRIES})이 개수는 막지만
 * <b>한 엔트리가 오래 걸리는 경우</b>는 막지 못한다.
 *
 * <p>격리하지 않으면 업로드 몇 건이 톰캣 워커 스레드를 붙잡고, 그 순간 <b>같은 인스턴스의 다른
 * 기능까지 멈춘다</b> - IP 규칙 조회, 목록, 헬스 체크. 단일 t4g.small 에 네 앱이 함께 사는
 * 구성이라 이 전파는 이론이 아니다. 이 데모의 주제가 "업로드 경계를 지킨다"인데, 경계는
 * 파일 내용만이 아니라 <b>자원</b>에도 있다.
 *
 * <h2>설계 선택</h2>
 * <ul>
 *   <li><b>전용 풀</b>: 판별을 요청 스레드에서 떼어낸다. 파싱이 멈춰도 워커는 타임아웃 후 돌아온다
 *       (요청 스레드에서 돌리면 타임아웃을 걸 대상 자체가 없다 - 자기 자신을 못 끊는다).</li>
 *   <li><b>대기하지 않는 세마포어</b>: 상한을 넘으면 짧게만 기다리고 <b>빠르게 거절</b>한다.
 *       느리게 성공하는 것보다 즉시 503 + 재시도 힌트를 주는 편이 호출자에게 낫고, 큐가 무한히
 *       자라 메모리를 먹는 일도 없다.</li>
 *   <li><b>SynchronousQueue</b>: 풀 큐를 두지 않는다. 큐가 있으면 세마포어로 이미 제한한 동시성
 *       위에 <b>두 번째 대기열</b>이 생겨 상한이 실질적으로 무의미해진다.</li>
 *   <li><b>인터럽트로 취소</b>: 타임아웃 시 {@code cancel(true)}. Tika 는 인터럽트에 즉시 반응하지
 *       않을 수 있으므로 이것은 <b>정리 요청</b>이고, 호출자를 풀어 주는 것이 1차 목적이다.
 *       그래서 permit 반납은 작업 종료 시점에 한다(취소 요청 시점이 아니라) - 인터럽트를 무시하는
 *       작업이 permit 을 미리 돌려받으면 상한을 넘겨 실행된다.</li>
 * </ul>
 *
 * <h2>상한 근거 (실측)</h2>
 * {@code ./gradlew benchmarkTest} 의 {@code ContentInspectionBenchmarkTest} 가 업로드 상한
 * (5MB) 경계까지 직접 측정한다. 외삽하지 않는 이유는 상한값의 근거로 추정보다 실측이 낫기 때문이다.
 *
 * <p>개발기 측정(min-of-7): 텍스트 64KB 2ms · 1MB 5ms · <b>5MB(업로드 상한) 7ms</b>,
 * zip 16엔트리 0ms · 200엔트리 3ms · <b>256엔트리 5MB 8ms</b>, 엔트리 4000개 1ms
 * (엔트리 상한 256 이 시간을 자르므로 4000개가 200개보다 빠르다 - 엔트리가 작기 때문).
 * 정상 입력 최악은 <b>8ms</b>. 서버는 t4g.small(arm64, 2 vCPU)이라 개발기 대비 보수적으로
 * 5배 느리다고 보면 <b>약 40ms</b>다.
 *
 * <p><b>타임아웃 1000ms</b>는 그 40ms 대비 <b>25배</b> 여유다. 정상 요청을
 * 거절하지 않을 만큼 넉넉하되, 병목이 생겼을 때 워커를 1초 안에 돌려받는다. <b>동시 4건</b>은
 * 2 vCPU 에서 CPU 바운드 작업을 코어 수의 2배까지만 겹치게 하는 값이다 - 그 위로는 문맥 교환만
 * 늘고 처리량이 오르지 않는다. 숫자를 바꿀 때는 벤치를 다시 돌려 이 문단을 갱신한다.
 */
@Component
public class ContentInspectionBulkhead {

    private static final Logger log = LoggerFactory.getLogger(ContentInspectionBulkhead.class);

    private static final AtomicInteger THREAD_SEQ = new AtomicInteger();

    private final Semaphore gate;
    private final int permits;
    private final long acquireWaitMs;
    private final long timeoutMs;
    private final int retryAfterSeconds;
    private final FileValidationMetrics metrics;
    private final ExecutorService pool;

    public ContentInspectionBulkhead(
            FileValidationMetrics metrics,
            @Value("${app.validation.inspect.concurrency:4}") int permits,
            @Value("${app.validation.inspect.acquire-wait-ms:50}") long acquireWaitMs,
            @Value("${app.validation.inspect.timeout-ms:1000}") long timeoutMs,
            @Value("${app.validation.inspect.retry-after-seconds:2}") int retryAfterSeconds) {
        this.metrics = metrics;
        this.permits = Math.max(1, permits);
        this.acquireWaitMs = Math.max(0, acquireWaitMs);
        this.timeoutMs = Math.max(1, timeoutMs);
        this.retryAfterSeconds = Math.max(1, retryAfterSeconds);
        this.gate = new Semaphore(this.permits);
        // corePoolSize=0 + SynchronousQueue: 유휴 시 스레드를 0으로 회수하고 큐로 쌓지 않는다.
        // maximumPoolSize 를 permits 와 같게 두어 세마포어가 유일한 동시성 관문이 되게 한다.
        this.pool = new ThreadPoolExecutor(0, this.permits, 30, TimeUnit.SECONDS,
                new SynchronousQueue<>(), r -> {
                    Thread t = new Thread(r, "content-inspect-" + THREAD_SEQ.incrementAndGet());
                    t.setDaemon(true); // 종료를 막지 않는다(파싱이 멈춰 있어도 JVM 은 내려간다)
                    return t;
                });
        log.info("event=bulkhead.configured concurrency={} timeoutMs={} acquireWaitMs={}",
                this.permits, this.timeoutMs, this.acquireWaitMs);
    }

    /**
     * 판별 작업을 격리 실행한다.
     *
     * @throws ValidationCapacityException 동시 상한 초과 또는 파싱 타임아웃(둘 다 재시도 가능한 실패)
     */
    public <T> T call(String op, Callable<T> task) {
        boolean acquired;
        try {
            acquired = gate.tryAcquire(acquireWaitMs, TimeUnit.MILLISECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new ValidationCapacityException("검증이 중단됐습니다. 다시 시도해 주세요.", retryAfterSeconds);
        }
        if (!acquired) {
            metrics.inspectRejected("bulkhead");
            log.warn("event=file.validation.rejected reason=bulkhead op={} concurrency={}", op, permits);
            throw new ValidationCapacityException(
                    "동시에 처리 중인 검증이 많습니다. 잠시 후 다시 시도해 주세요.", retryAfterSeconds);
        }

        Future<T> future;
        try {
            future = pool.submit(() -> {
                try {
                    return task.call();
                } finally {
                    // permit 은 작업이 실제로 끝날 때 반납한다. 타임아웃 시점에 반납하면 인터럽트를
                    // 무시한 작업이 계속 도는 채로 새 작업이 들어와 상한을 넘긴다.
                    gate.release();
                }
            });
        } catch (RuntimeException e) {
            // 풀이 작업을 받지 못했다(SynchronousQueue - 인수할 스레드 없음). 위 finally 가 돌지 않으므로 직접 반납.
            gate.release();
            metrics.inspectRejected("bulkhead");
            log.warn("event=file.validation.rejected reason=pool op={}", op);
            throw new ValidationCapacityException(
                    "동시에 처리 중인 검증이 많습니다. 잠시 후 다시 시도해 주세요.", retryAfterSeconds);
        }

        try {
            return future.get(timeoutMs, TimeUnit.MILLISECONDS);
        } catch (TimeoutException e) {
            future.cancel(true); // 정리 요청. 호출자를 풀어 주는 것이 1차 목적이다.
            metrics.inspectRejected("timeout");
            log.warn("event=file.validation.rejected reason=timeout op={} timeoutMs={}", op, timeoutMs);
            throw new ValidationCapacityException(
                    "파일 검증이 제한 시간을 넘었습니다. 더 작은 파일로 시도해 주세요.", retryAfterSeconds);
        } catch (InterruptedException e) {
            future.cancel(true);
            Thread.currentThread().interrupt();
            throw new ValidationCapacityException("검증이 중단됐습니다. 다시 시도해 주세요.", retryAfterSeconds);
        } catch (ExecutionException e) {
            // 작업 자체의 예외는 감싸지 않고 그대로 올린다 - 용량 문제와 로직 문제를 섞으면 안 된다.
            Throwable cause = e.getCause();
            if (cause instanceof RuntimeException re) {
                throw re;
            }
            throw new IllegalStateException("콘텐츠 판별 중 오류", cause);
        }
    }

    @PreDestroy
    void shutdown() {
        pool.shutdownNow();
    }

    /** 테스트/관측용 - 설정된 동시 상한. */
    public int concurrency() {
        return permits;
    }
}

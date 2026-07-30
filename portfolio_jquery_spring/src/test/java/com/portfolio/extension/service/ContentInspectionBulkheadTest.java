package com.portfolio.extension.service;

import com.portfolio.extension.exception.ValidationCapacityException;
import com.portfolio.extension.observability.FileValidationMetrics;
import com.portfolio.extension.repository.CustomExtensionRepository;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 벌크헤드 계약 검증 - <b>스프링 컨텍스트 없이</b> 순수 단위로 돈다(동시성 테스트에 컨텍스트
 * 기동 시간을 섞으면 타이밍이 불안정해진다).
 *
 * <p>검증하는 것은 "빠르게 거절한다"와 "느린 작업이 호출자를 붙잡지 않는다" 두 가지다.
 * 두 성질이 없으면 벌크헤드는 이름만 벌크헤드다.
 */
class ContentInspectionBulkheadTest {

    private static FileValidationMetrics metrics(MeterRegistry registry) {
        CustomExtensionRepository repo = Mockito.mock(CustomExtensionRepository.class);
        Mockito.when(repo.count()).thenReturn(0L);
        return new FileValidationMetrics(registry, repo);
    }

    private static ContentInspectionBulkhead bulkhead(MeterRegistry registry, int permits, long timeoutMs) {
        return new ContentInspectionBulkhead(metrics(registry), permits, 10, timeoutMs, 2);
    }

    @Test
    @DisplayName("정상 작업은 결과를 그대로 돌려준다")
    void passesThrough() {
        MeterRegistry registry = new SimpleMeterRegistry();
        ContentInspectionBulkhead b = bulkhead(registry, 2, 1000);
        assertThat(b.call("op", () -> "ok")).isEqualTo("ok");
        assertThat(registry.find("file.validation.rejected").counters()).isEmpty();
    }

    @Test
    @DisplayName("작업의 예외는 감싸지 않고 그대로 올린다 - 용량 문제와 로직 문제를 섞지 않는다")
    void propagatesTaskException() {
        ContentInspectionBulkhead b = bulkhead(new SimpleMeterRegistry(), 2, 1000);
        assertThatThrownBy(() -> b.call("op", () -> {
            throw new IllegalArgumentException("도메인 오류");
        })).isInstanceOf(IllegalArgumentException.class).hasMessage("도메인 오류");
    }

    @Test
    @DisplayName("동시 상한을 넘으면 기다리지 않고 거절한다(503 + 재시도 힌트)")
    void rejectsOverConcurrency() throws Exception {
        MeterRegistry registry = new SimpleMeterRegistry();
        ContentInspectionBulkhead b = bulkhead(registry, 1, 5000);
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);

        Thread holder = new Thread(() -> b.call("hold", () -> {
            started.countDown();
            release.await(5, TimeUnit.SECONDS);
            return "held";
        }));
        holder.setDaemon(true);
        holder.start();
        assertThat(started.await(2, TimeUnit.SECONDS)).isTrue();

        long t0 = System.nanoTime();
        ValidationCapacityException thrown = null;
        try {
            b.call("second", () -> "should not run");
        } catch (ValidationCapacityException e) {
            thrown = e;
        }
        long elapsedMs = (System.nanoTime() - t0) / 1_000_000;

        assertThat(thrown).as("상한 초과는 거절돼야 한다").isNotNull();
        assertThat(thrown.getRetryAfterSeconds()).isEqualTo(2);
        // 핵심: 앞 작업(5초)을 기다리지 않는다. acquire-wait(10ms) 수준에서 즉시 돌아온다.
        assertThat(elapsedMs).as("빠르게 거절해야 한다").isLessThan(1000);
        assertThat(registry.get("file.validation.rejected").tag("reason", "bulkhead").counter().count())
                .isEqualTo(1.0);

        release.countDown();
        holder.join(3000);
    }

    @Test
    @DisplayName("파싱이 제한 시간을 넘으면 호출자를 풀어 주고 취소를 요청한다")
    void timesOut() {
        MeterRegistry registry = new SimpleMeterRegistry();
        ContentInspectionBulkhead b = bulkhead(registry, 2, 60);
        AtomicBoolean interrupted = new AtomicBoolean(false);

        long t0 = System.nanoTime();
        assertThatThrownBy(() -> b.call("slow", () -> {
            try {
                Thread.sleep(5000);
            } catch (InterruptedException e) {
                interrupted.set(true);
                Thread.currentThread().interrupt();
            }
            return "late";
        })).isInstanceOf(ValidationCapacityException.class);
        long elapsedMs = (System.nanoTime() - t0) / 1_000_000;

        // 호출자는 타임아웃(60ms) 근처에서 돌아온다 - 작업의 5초를 기다리지 않는다.
        assertThat(elapsedMs).as("타임아웃 시 호출자가 즉시 풀려야 한다").isLessThan(2000);
        assertThat(registry.get("file.validation.rejected").tag("reason", "timeout").counter().count())
                .isEqualTo(1.0);
    }

    @Test
    @DisplayName("인터럽트를 무시하는 작업도 상한을 넘겨 실행되지 않는다 - permit 은 작업이 끝날 때 반납한다")
    void permitReturnsOnlyWhenTaskEnds() throws Exception {
        // 여기서 작업이 Thread.sleep 이 아니라 **인터럽트를 보지 않는 바쁜 루프**인 것이 핵심이다.
        // sleep 은 cancel(true) 에 즉시 InterruptedException 으로 끝나므로 permit 이 바로 돌아오고,
        // 그러면 이 불변식을 검증할 수 없다. Tika 파싱처럼 인터럽트에 즉시 반응하지 않는 작업이
        // 실제 위험이고, 그때 permit 을 취소 시점에 반납하면 동시 실행이 상한을 넘는다.
        ContentInspectionBulkhead b = bulkhead(new SimpleMeterRegistry(), 1, 50);
        long busyUntil = System.nanoTime() + 400_000_000L; // 400ms

        assertThatThrownBy(() -> b.call("uninterruptible", () -> {
            while (System.nanoTime() < busyUntil) {
                Math.sqrt(System.nanoTime()); // 인터럽트 상태를 확인하지 않는다
            }
            return "late";
        })).isInstanceOf(ValidationCapacityException.class);

        assertThatThrownBy(() -> b.call("next", () -> "immediate"))
                .as("앞 작업이 아직 도는 동안에는 permit 이 비어 있어야 한다")
                .isInstanceOf(ValidationCapacityException.class);

        // 앞 작업이 스스로 끝나면 permit 이 돌아와 다시 통과한다.
        Thread.sleep(700);
        assertThat(b.call("after", () -> "ok")).isEqualTo("ok");
    }
}

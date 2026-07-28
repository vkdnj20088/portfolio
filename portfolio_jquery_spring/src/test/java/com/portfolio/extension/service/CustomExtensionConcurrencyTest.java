package com.portfolio.extension.service;

import com.portfolio.extension.domain.CustomExtension;
import com.portfolio.extension.exception.DuplicateExtensionException;
import com.portfolio.extension.exception.ExtensionLimitExceededException;
import com.portfolio.extension.repository.CustomExtensionRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 동시성 회귀 테스트. 변별 포인트(200 경계 TOCTOU / 동일값 레이스)를
 * "인지"에 그치지 않고 재현, 검증한다. ReentrantLock 이 임계 구역을 직렬화하므로
 * 결과는 결정적이다(초과 저장 0, 중복 저장 0).
 */
@SpringBootTest
class CustomExtensionConcurrencyTest {

    @Autowired
    private CustomExtensionService service;
    @Autowired
    private CustomExtensionRepository customRepository;

    @BeforeEach
    void clean() {
        customRepository.deleteAll();
    }

    @Test
    void concurrentAddsNeverExceedLimit() throws Exception {
        // 195개 선점 -> 5칸 남음. 20개 동시 추가 -> 정확히 5개만 성공해야 한다.
        int prefill = CustomExtensionService.MAX_CUSTOM - 5; // 195
        customRepository.saveAll(
                IntStream.range(0, prefill).mapToObj(i -> new CustomExtension("seed" + i)).toList());

        int threads = 20;
        AtomicInteger ok = new AtomicInteger();
        AtomicInteger limited = new AtomicInteger();
        AtomicInteger other = new AtomicInteger();

        runConcurrently(threads, idx -> {
            try {
                service.add("con" + idx);
                ok.incrementAndGet();
            } catch (ExtensionLimitExceededException e) {
                limited.incrementAndGet();
            } catch (RuntimeException e) {
                other.incrementAndGet();
            }
        });

        assertThat(ok.get()).isEqualTo(5);
        assertThat(limited.get()).isEqualTo(15);
        assertThat(other.get()).isZero();
        assertThat(customRepository.count()).isEqualTo(CustomExtensionService.MAX_CUSTOM);
    }

    @Test
    void concurrentDuplicateAddsInsertOnlyOnce() throws Exception {
        int threads = 12;
        AtomicInteger ok = new AtomicInteger();
        AtomicInteger dup = new AtomicInteger();
        AtomicInteger other = new AtomicInteger();

        runConcurrently(threads, idx -> {
            try {
                service.add("sh"); // 모두 같은 값
                ok.incrementAndGet();
            } catch (DuplicateExtensionException e) {
                dup.incrementAndGet();
            } catch (RuntimeException e) {
                other.incrementAndGet();
            }
        });

        assertThat(ok.get()).isEqualTo(1);
        assertThat(dup.get()).isEqualTo(threads - 1);
        assertThat(other.get()).isZero();
        assertThat(customRepository.count()).isEqualTo(1);
    }

    /** threads 개의 작업을 CountDownLatch 로 동시에 출발시키고 완료를 대기한다. */
    private void runConcurrently(int threads, java.util.function.IntConsumer task) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        CountDownLatch start = new CountDownLatch(1);
        List<Future<?>> futures = new ArrayList<>();
        try {
            for (int i = 0; i < threads; i++) {
                final int idx = i;
                futures.add(pool.submit(() -> {
                    try {
                        start.await();
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                        return;
                    }
                    task.accept(idx);
                }));
            }
            start.countDown();
            for (Future<?> f : futures) {
                f.get(15, TimeUnit.SECONDS);
            }
        } finally {
            pool.shutdownNow();
        }
    }
}

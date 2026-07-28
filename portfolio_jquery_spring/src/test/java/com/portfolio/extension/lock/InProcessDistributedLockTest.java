package com.portfolio.extension.lock;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * in-process 락의 두 계약을 검증한다(Docker 불필요, 순수 스레드).
 *  1) 같은 키의 임계 구역은 직렬화된다(동시 진입 최대 1).
 *  2) 다른 키의 임계 구역은 서로를 막지 않는다(키별 격리).
 */
class InProcessDistributedLockTest {

    private final InProcessDistributedLock lock = new InProcessDistributedLock();

    @Test
    void sameKeySerializesCriticalSections() throws Exception {
        int threads = 16;
        AtomicInteger concurrent = new AtomicInteger();
        AtomicInteger maxConcurrent = new AtomicInteger();
        AtomicInteger completed = new AtomicInteger();

        ExecutorService pool = Executors.newFixedThreadPool(threads);
        CountDownLatch start = new CountDownLatch(1);
        List<Future<?>> futures = new ArrayList<>();
        try {
            for (int i = 0; i < threads; i++) {
                futures.add(pool.submit((Callable<Void>) () -> {
                    start.await();
                    lock.executeWithLock("same-key", () -> {
                        int now = concurrent.incrementAndGet();
                        maxConcurrent.accumulateAndGet(now, Math::max);
                        sleep(5);
                        concurrent.decrementAndGet();
                        completed.incrementAndGet();
                        return null;
                    });
                    return null;
                }));
            }
            start.countDown();
            for (Future<?> f : futures) {
                f.get(10, TimeUnit.SECONDS);
            }
        } finally {
            pool.shutdownNow();
        }

        assertThat(maxConcurrent.get()).isEqualTo(1); // 임계 구역에 둘 이상 동시 진입한 적 없음
        assertThat(completed.get()).isEqualTo(threads);
    }

    @Test
    void differentKeysDoNotBlockEachOther() throws Exception {
        // 서로 다른 키를 쥔 두 임계 구역이 모두 barrier 에 도달하면 통과 - 막혔다면 barrier 에서 타임아웃.
        CyclicBarrier barrier = new CyclicBarrier(2);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<Boolean> a = pool.submit(() -> lock.executeWithLock("key-a", () -> awaitBarrier(barrier)));
            Future<Boolean> b = pool.submit(() -> lock.executeWithLock("key-b", () -> awaitBarrier(barrier)));
            assertThat(a.get(5, TimeUnit.SECONDS)).isTrue();
            assertThat(b.get(5, TimeUnit.SECONDS)).isTrue();
        } finally {
            pool.shutdownNow();
        }
    }

    private static boolean awaitBarrier(CyclicBarrier barrier) {
        try {
            barrier.await(3, TimeUnit.SECONDS);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private static void sleep(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}

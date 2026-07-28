package com.portfolio.extension.lock;

import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.mysql.MySQLContainer;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * #9 분산 락 통합 테스트 - MySQL {@code GET_LOCK} 이 <b>세션(커넥션) 간</b> 상호배제를 보장함을
 * 실제 MySQL 8(Testcontainers)에서 실증한다.
 *
 * <p>{@code provider=mysql} 로 띄워 주입되는 {@link DistributedLock} 이 {@link MySqlNamedLock} 이고,
 * 서로 다른 커넥션에서 같은 키로 진입한 두 임계 구역이 동시에 겹치지 않음을 확인한다. 이것이 곧
 * 다중 인스턴스(각자 다른 커넥션)에서의 클러스터 전역 직렬화 보장이다.
 *
 * <p>대기자마다 커넥션 하나를 점유하므로(GET_LOCK 특성) 스레드 수를 작게 잡아 풀을 고갈시키지 않는다.
 * Docker 가 필요하므로 {@code @Tag("integration")} 으로 분리한다(기본 test 제외, integrationTest/CI 실행).
 */
@Tag("integration")
@Testcontainers
@SpringBootTest
@TestPropertySource(properties = {
        "spring.h2.console.enabled=false",
        "app.distributed-lock.provider=mysql",
        "app.distributed-lock.timeout-seconds=10"
})
class MySqlNamedLockIT {

    @Container
    static final MySQLContainer MYSQL = new MySQLContainer("mysql:8.0");

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", MYSQL::getJdbcUrl);
        registry.add("spring.datasource.username", MYSQL::getUsername);
        registry.add("spring.datasource.password", MYSQL::getPassword);
        registry.add("spring.datasource.driver-class-name", MYSQL::getDriverClassName);
    }

    @Autowired
    private DistributedLock lock;

    @Test
    void providerResolvesToMySqlNamedLock() {
        assertThat(lock).isInstanceOf(MySqlNamedLock.class);
    }

    @Test
    void getLockSerializesAcrossConnections() throws Exception {
        int threads = 4;
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
                    lock.executeWithLock("named-lock-it", () -> {
                        int now = concurrent.incrementAndGet();
                        maxConcurrent.accumulateAndGet(now, Math::max);
                        sleep(50); // 겹칠 여지를 주고도 겹치지 않아야 한다
                        concurrent.decrementAndGet();
                        completed.incrementAndGet();
                        return null;
                    });
                    return null;
                }));
            }
            start.countDown();
            for (Future<?> f : futures) {
                f.get(60, TimeUnit.SECONDS);
            }
        } finally {
            pool.shutdownNow();
        }

        assertThat(maxConcurrent.get()).isEqualTo(1); // GET_LOCK 이 세션 간 임계 구역을 직렬화
        assertThat(completed.get()).isEqualTo(threads);
    }

    private static void sleep(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}

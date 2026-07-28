package com.portfolio.extension.service;

import com.portfolio.extension.domain.CustomExtension;
import com.portfolio.extension.exception.DuplicateExtensionException;
import com.portfolio.extension.exception.ExtensionLimitExceededException;
import com.portfolio.extension.lock.DistributedLock;
import com.portfolio.extension.lock.MySqlNamedLock;
import com.portfolio.extension.repository.CustomExtensionRepository;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.IntConsumer;
import java.util.stream.IntStream;
import org.junit.jupiter.api.BeforeEach;
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

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 분산 락 <b>실경로</b> 통합 테스트(#Q4) - {@code app.distributed-lock.provider=mysql} 을 켜서
 * 실제 MySQL {@code GET_LOCK} 을 통해 {@link CustomExtensionService#add} 의 임계 구역이 직렬화됨을
 * 실증한다.
 *
 * <p>왜 필요한가: 기존 {@code CustomExtensionConcurrencyMySqlIT} 는 실 MySQL 을 쓰지만 <b>기본
 * in-process 락</b>으로 돌아, "UNIQUE 안전망"은 검증해도 GET_LOCK 이 서비스 경로를 직렬화하는지는
 * 검증하지 못했다({@code MySqlNamedLockIT} 는 GET_LOCK 을 고립 검증). 이 테스트는 둘을 잇는다 -
 * 프로퍼티로 mysql 프로바이더를 켜고, 주입된 락이 실제 {@link MySqlNamedLock} 임을 확인한 뒤,
 * 동시성 시나리오(200 경계 / 동일값 레이스)를 서비스로 구동해 <b>초과 0 / 중복 0</b> 을 굳힌다.
 *
 * <p>Docker 필요라 {@code @Tag("integration")} - {@code ./gradlew integrationTest}.
 */
@Tag("integration")
@Testcontainers
@SpringBootTest
@TestPropertySource(properties = {
        "spring.h2.console.enabled=false",
        "app.distributed-lock.provider=mysql", // 핵심: prod 분산 락 전략을 켠다
        // GET_LOCK 은 대기자마다 커넥션을 점유한다(MySqlNamedLock 이 문서화한 트레이드오프).
        // 20스레드가 각자 락 커넥션 + 트랜잭션 커넥션을 필요로 하므로 풀을 넉넉히 잡는다.
        "spring.datasource.hikari.maximum-pool-size=48"
})
class CustomExtensionMySqlLockPathIT {

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
    private CustomExtensionService service;
    @Autowired
    private CustomExtensionRepository customRepository;
    @Autowired
    private DistributedLock distributedLock;

    @BeforeEach
    void clean() {
        customRepository.deleteAll();
    }

    @Test
    void mysqlProviderIsActive() {
        // 프로퍼티가 실제로 GET_LOCK 구현을 주입했음을 확인(in-process 가 아니라).
        assertThat(distributedLock).isInstanceOf(MySqlNamedLock.class);
    }

    @Test
    void getLockSerializesLimitBoundary_onRealMySql() throws Exception {
        int prefill = CustomExtensionService.MAX_CUSTOM - 5; // 5칸 남김
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

        assertThat(ok.get()).isEqualTo(5);        // GET_LOCK 직렬화로 정확히 5칸만 채움
        assertThat(limited.get()).isEqualTo(15);
        assertThat(other.get()).isZero();
        assertThat(customRepository.count()).isEqualTo(CustomExtensionService.MAX_CUSTOM);
    }

    @Test
    void getLockSerializesDuplicateRace_onRealMySql() throws Exception {
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

    private void runConcurrently(int threads, IntConsumer task) throws Exception {
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
                f.get(30, TimeUnit.SECONDS);
            }
        } finally {
            pool.shutdownNow();
        }
    }
}

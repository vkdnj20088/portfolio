package com.portfolio.extension.service;

import com.portfolio.extension.domain.CustomExtension;
import com.portfolio.extension.exception.DuplicateExtensionException;
import com.portfolio.extension.exception.ExtensionLimitExceededException;
import com.portfolio.extension.repository.CustomExtensionRepository;
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

import static org.assertj.core.api.Assertions.assertThat;

/**
 * #7 동시성 통합 테스트 - 실제 MySQL 8(Testcontainers)에서 실증한다.
 *
 * <p>기존 {@code CustomExtensionConcurrencyTest} 는 H2(MODE=MySQL)로 돈다. H2 는 InnoDB 락/격리,
 * 실제 UNIQUE 위반 타이밍을 재현하지 못한다. 이 테스트는 <b>prod 엔진(MySQL 8 InnoDB)</b>에 같은
 * 시나리오를 돌려 헤드라인 동시성 보장(200 경계 TOCTOU / 동일값 레이스 -> 초과 0, 중복 0)을 굳힌다.
 * 스키마는 {@code ddl-auto=create-drop} 로 엔티티에서 생성하므로, 엔티티-MySQL 매핑 정합도 함께
 * 확인된다(손관리 {@code db/mysql-schema.sql} 과의 정합 검증은 Flyway 도입 시 마이그레이션+validate 로
 * 더 정확히 다루는 것이 맞다).
 *
 * <p>Docker 가 필요하므로 {@code @Tag("integration")} 으로 분리한다. 기본 {@code ./gradlew test} 는
 * 제외하고, {@code ./gradlew integrationTest} 및 CI(GitHub 러너의 Docker)에서 실행한다.
 */
@Tag("integration")
@Testcontainers
@SpringBootTest
@TestPropertySource(properties = "spring.h2.console.enabled=false") // MySQL 로 붙으므로 H2 콘솔 오토컨피그 비활성
class CustomExtensionConcurrencyMySqlIT {

    @Container
    static final MySQLContainer MYSQL = new MySQLContainer("mysql:8.0");

    // 기본(H2) 데이터소스를 컨테이너의 실제 MySQL 로 덮어쓴다. supplier 는 컨테이너가 뜬 뒤 평가된다.
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

    @BeforeEach
    void clean() {
        customRepository.deleteAll();
    }

    @Test
    void concurrentAddsNeverExceedLimitOnRealMySql() throws Exception {
        // 195개 선점 -> 5칸 남음. 20개 동시 추가 -> 정확히 5개만 성공해야 한다.
        int prefill = CustomExtensionService.MAX_CUSTOM - 5;
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
    void concurrentDuplicateAddsInsertOnlyOnceOnRealMySql() throws Exception {
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

    /** threads 개의 작업을 CountDownLatch 로 동시에 출발시키고 완료를 대기한다(실 DB 지연 감안 30s). */
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

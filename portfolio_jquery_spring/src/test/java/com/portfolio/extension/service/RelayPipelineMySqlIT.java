package com.portfolio.extension.service;

import com.portfolio.extension.domain.RelayJob;
import com.portfolio.extension.relay.Mulberry32;
import com.portfolio.extension.relay.RelayJobType;
import com.portfolio.extension.relay.RelayPublishMode;
import com.portfolio.extension.relay.RelayScenario;
import com.portfolio.extension.repository.RelayAttemptRepository;
import com.portfolio.extension.repository.RelayJobRepository;
import com.portfolio.extension.repository.RelayOutboxRepository;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.mysql.MySQLContainer;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 재시도 파이프라인 통합 테스트 - 실제 MySQL 8(InnoDB)에서만 의미가 있는 세 성질을 실증한다.
 *
 * <ol>
 *   <li><b>SKIP LOCKED 상호배제</b> - 두 "워커"가 같은 준비 집합을 동시에 리스해도 같은 작업을
 *       두 번 집지 않고, 서로를 기다리지도 않는다. 분배가 공평하다는 뜻은 아니다(테스트 본문
 *       주석 참조). H2 는 InnoDB 행 잠금 의미론을 재현하지 못하므로 여기서만 실증된다.</li>
 *   <li><b>멱등 UNIQUE 동시성</b> - 같은 키의 동시 예약이 전부 한 작업으로 접힌다(초과 생성 0).</li>
 *   <li><b>아웃박스 원자성</b> - 저장 트랜잭션이 구르면 이벤트도 함께 구른다(직접 발행은 유령을 남긴다).</li>
 * </ol>
 *
 * <p>워커 스케줄러는 끈다 - 리스 경합을 테스트가 직접 연출해야 한다.
 * Docker 필요 -> {@code @Tag("integration")}, CI 의 {@code ./gradlew integrationTest} 에서 실행.
 */
@Tag("integration")
@Testcontainers
@SpringBootTest
@TestPropertySource(properties = {
        "spring.h2.console.enabled=false",
        "app.relay.worker.enabled=false",
})
class RelayPipelineMySqlIT {

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
    private RelayJobService service;
    @Autowired
    private RelayJobRepository jobs;
    @Autowired
    private RelayAttemptRepository attempts;
    @Autowired
    private RelayOutboxRepository outbox;
    @Autowired
    private PlatformTransactionManager txManager;

    @BeforeEach
    void clean() {
        attempts.deleteAll();
        outbox.deleteAll();
        jobs.deleteAll();
    }

    private void enqueueReady(String key) {
        service.enqueue(key, RelayJobType.WEBHOOK_PUSH, "it", RelayScenario.ALWAYS_FAIL,
                Mulberry32.hashSeed(key), 3, RelayPublishMode.OUTBOX, false);
    }

    @Test
    void skipLockedLease_twoWorkersNeverPickSameJob() throws Exception {
        // 준비된 작업 6건(first attempt 지연을 지나도록 과거로 밀 수 없어, 지연 1s 를 기다린다)
        for (int i = 0; i < 6; i++) {
            enqueueReady("it-lease-" + i);
        }
        Thread.sleep(1_200); // FIRST_ATTEMPT_DELAY_MS 경과 -> 전부 리스 후보

        TransactionTemplate tx = new TransactionTemplate(txManager);
        CountDownLatch bothLeased = new CountDownLatch(2);
        CountDownLatch release = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        List<Future<List<Long>>> futures = new ArrayList<>();

        // 두 워커가 리스 트랜잭션을 "열어 둔 채" 서로를 만나게 한다 - SKIP LOCKED 가 없다면
        // 두 번째 워커는 같은 행을 기다리거나(FOR UPDATE) 같은 작업을 집는다.
        for (int w = 0; w < 2; w++) {
            futures.add(pool.submit(() -> tx.execute(status -> {
                List<Long> ids = jobs.leaseReady(Instant.now(), 3).stream()
                        .map(RelayJob::getId).toList();
                bothLeased.countDown();
                try {
                    release.await(10, TimeUnit.SECONDS); // 상대가 리스를 마칠 때까지 잠금 유지
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
                return ids;
            })));
        }
        // 비차단의 증거가 이 대기다: SKIP LOCKED 가 없다면(맨 FOR UPDATE) 늦은 워커가
        // 상대 잠금을 기다리느라 여기서 10초를 넘겨 실패한다.
        assertThat(bothLeased.await(10, TimeUnit.SECONDS)).isTrue();
        release.countDown();

        List<Long> first = futures.get(0).get(10, TimeUnit.SECONDS);
        List<Long> second = futures.get(1).get(10, TimeUnit.SECONDS);
        pool.shutdown();

        // "3건씩 공평 분배"는 InnoDB 가 보장하지 않는다(첫 CI 실행이 실증했다): 이 쿼리의
        // ORDER BY 가 filesort 로 떨어지면 InnoDB 는 LIMIT 밖의 검사 행 전부를 잠가서,
        // 먼저 정렬한 워커가 6건을 다 잠근 채 3건만 반환하고 상대는 전부 건너뛰어 0건이 된다.
        // SKIP LOCKED 의 실제 보장 셋만 단언한다: 상호배제(겹침 0), 최소 한 워커는 가득 리스,
        // 그리고 잠금이 풀리면 남은 작업이 전부 다시 리스된다(유실 없음).
        assertThat(first).doesNotContainAnyElementsOf(second); // 상호배제 - 겹침 0
        assertThat(first.size()).isLessThanOrEqualTo(3);
        assertThat(second.size()).isLessThanOrEqualTo(3);
        assertThat(Math.max(first.size(), second.size())).isEqualTo(3);

        // 두 트랜잭션 커밋 후: 아무 작업도 잠금에 물려 사라지지 않았다(전부 다시 후보).
        List<Long> after = tx.execute(status -> jobs.leaseReady(Instant.now(), 10).stream()
                .map(RelayJob::getId).toList());
        assertThat(after).hasSize(6);
    }

    @Test
    void concurrentSameKeyEnqueues_collapseToOneJob() throws Exception {
        String key = "it-idem-race";
        int threads = 8;
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        List<Future<RelayJobService.EnqueueResult>> futures = new ArrayList<>();
        for (int i = 0; i < threads; i++) {
            futures.add(pool.submit(() -> {
                start.await(5, TimeUnit.SECONDS);
                return service.enqueue(key, RelayJobType.PAYMENT_NOTIFY, "race",
                        RelayScenario.ALWAYS_SUCCEED, 1, 3, RelayPublishMode.OUTBOX, false);
            }));
        }
        start.countDown();

        long created = 0;
        for (Future<RelayJobService.EnqueueResult> f : futures) {
            if (!f.get(15, TimeUnit.SECONDS).duplicate()) {
                created++;
            }
        }
        pool.shutdown();

        assertThat(created).isEqualTo(1); // 애플리케이션 검사가 놓쳐도 UNIQUE 가 접는다
        assertThat(jobs.findByIdempotencyKey(key)).isPresent();
        assertThat(jobs.count()).isEqualTo(1);
    }

    @Test
    void outboxAtomicity_rollbackLeavesNothing_directPublishLeavesGhost() {
        service.enqueue("it-ghost-outbox", RelayJobType.RECEIPT_EMAIL, "x",
                RelayScenario.ALWAYS_SUCCEED, 1, 3, RelayPublishMode.OUTBOX, true);
        assertThat(jobs.findByIdempotencyKey("it-ghost-outbox")).isEmpty();
        assertThat(outbox.count()).isZero();
        assertThat(outbox.countGhostEvents()).isZero();

        service.enqueue("it-ghost-direct", RelayJobType.RECEIPT_EMAIL, "x",
                RelayScenario.ALWAYS_SUCCEED, 1, 3, RelayPublishMode.DIRECT, true);
        assertThat(jobs.findByIdempotencyKey("it-ghost-direct")).isEmpty();
        assertThat(outbox.countGhostEvents()).isEqualTo(1);
    }
}

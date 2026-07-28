package com.portfolio.extension.performance;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.mysql.MySQLContainer;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * OFFSET vs 키셋 페이지네이션 지연 벤치(#I5, 설명형/재현 가능) - 실제 MySQL 8(Testcontainers).
 *
 * <p>왜 MySQL 인가: "깊은 페이지에서 OFFSET 이 느려진다"는 <b>디스크/버퍼풀 기반 DB</b>에서 실재한다.
 * OFFSET N 은 앞 N 행을 실제로 읽어 버려야 하지만, 키셋(WHERE (created_at,id) &lt; 커서)은 정렬 인덱스
 * ({@code idx_ip_rule_created}, Flyway V3)를 곧장 seek 한다. (H2 인메모리는 스킵이 거의 공짜라 이
 * 차이가 드러나지 않아, 실측은 MySQL 로 한다.)
 *
 * <p>단정: <b>정확성 동치</b>(두 방식이 같은 페이지 반환)를 firm 하게, 지연은 min-of-N 으로 안정화해
 * 키셋이 더 빠름을 확인한다. Docker 필요라 {@code @Tag("benchmark")}: {@code ./gradlew benchmarkTest}.
 */
@Tag("benchmark")
@Testcontainers
@SpringBootTest
@TestPropertySource(properties = {
        "spring.h2.console.enabled=false",
        "spring.flyway.enabled=true",
        "spring.jpa.hibernate.ddl-auto=validate",
        "app.ip-seed.count=0"
})
class OffsetVsKeysetBenchmarkTest {

    private static final Logger log = LoggerFactory.getLogger(OffsetVsKeysetBenchmarkTest.class);

    private static final int ROWS = 100_000;
    private static final int PAGE = 30;
    private static final int DEEP_OFFSET = ROWS - PAGE - 1; // 거의 맨 끝 페이지(최악)
    private static final int ITERATIONS = 7;

    @Container
    static final MySQLContainer MYSQL = new MySQLContainer("mysql:8.0")
            .withUrlParam("rewriteBatchedStatements", "true"); // 대량 배치 시딩 고속화

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", MYSQL::getJdbcUrl);
        registry.add("spring.datasource.username", MYSQL::getUsername);
        registry.add("spring.datasource.password", MYSQL::getPassword);
        registry.add("spring.datasource.driver-class-name", MYSQL::getDriverClassName);
    }

    @Autowired
    private JdbcTemplate jdbc;

    @BeforeEach
    void seedOnce() {
        Integer existing = jdbc.queryForObject("SELECT COUNT(*) FROM ip_access_rule", Integer.class);
        if (existing != null && existing >= ROWS) return;
        jdbc.update("DELETE FROM ip_access_rule");
        Instant base = Instant.parse("2024-01-01T00:00:00Z");
        int batchSize = 5_000;
        List<Object[]> batch = new ArrayList<>(batchSize);
        for (int i = 0; i < ROWS; i++) {
            Timestamp ts = Timestamp.from(base.plusSeconds(i)); // 1초 간격 -> 정렬/키셋 기준 유니크
            batch.add(new Object[]{"10." + (i % 240) + "." + (i / 240 % 240) + "." + (i % 250),
                    "규칙", ts, ts, ts});
            if (batch.size() == batchSize) {
                flush(batch);
                batch.clear();
            }
        }
        if (!batch.isEmpty()) flush(batch);
    }

    private void flush(List<Object[]> batch) {
        jdbc.batchUpdate("INSERT INTO ip_access_rule (ip_address, description, start_at, end_at, created_at) "
                + "VALUES (?,?,?,?,?)", batch);
    }

    @Test
    void keysetIsFasterThanOffset_atDeepPage_andReturnsSamePage() {
        var cursor = jdbc.queryForMap(
                "SELECT created_at, id FROM ip_access_rule ORDER BY created_at DESC, id DESC "
                        + "LIMIT 1 OFFSET " + (DEEP_OFFSET - 1));
        Object cAt = cursor.get("created_at");
        Number cId = (Number) cursor.get("id");

        List<Long> offsetPage = offsetPage();
        List<Long> keysetPage = keysetPage(cAt, cId.longValue());
        assertThat(keysetPage).as("키셋과 OFFSET 이 같은 페이지를 반환").isEqualTo(offsetPage);

        long offsetNanos = bestOf(this::offsetPage);
        long keysetNanos = bestOf(() -> keysetPage(cAt, cId.longValue()));
        double offsetMs = offsetNanos / 1_000_000.0;
        double keysetMs = keysetNanos / 1_000_000.0;
        log.info("[벤치 #I5] MySQL8 rows={} page={} deepOffset={} | OFFSET best={}ms, KEYSET best={}ms, 배율={}x",
                ROWS, PAGE, DEEP_OFFSET, fmt(offsetMs), fmt(keysetMs), fmt(offsetMs / Math.max(keysetMs, 1e-6)));

        assertThat(keysetNanos)
                .as("깊은 페이지에서 키셋이 OFFSET 보다 빠르다(OFFSET 은 앞 %d 행을 읽어 버림)", DEEP_OFFSET)
                .isLessThan(offsetNanos);
    }

    private List<Long> offsetPage() {
        return jdbc.queryForList(
                "SELECT id FROM ip_access_rule ORDER BY created_at DESC, id DESC LIMIT " + PAGE
                        + " OFFSET " + DEEP_OFFSET, Long.class);
    }

    private List<Long> keysetPage(Object cAt, long cId) {
        return jdbc.queryForList(
                "SELECT id FROM ip_access_rule WHERE created_at < ? OR (created_at = ? AND id < ?) "
                        + "ORDER BY created_at DESC, id DESC LIMIT " + PAGE,
                Long.class, cAt, cAt, cId);
    }

    // 여러 번 측정해 최소값(최적 지연) 사용 - 잡음을 줄여 비교를 안정화한다.
    private long bestOf(Runnable q) {
        q.run(); // 워밍업
        long best = Long.MAX_VALUE;
        for (int i = 0; i < ITERATIONS; i++) {
            long t0 = System.nanoTime();
            q.run();
            best = Math.min(best, System.nanoTime() - t0);
        }
        return best;
    }

    private static String fmt(double v) {
        return String.format("%.3f", v);
    }
}

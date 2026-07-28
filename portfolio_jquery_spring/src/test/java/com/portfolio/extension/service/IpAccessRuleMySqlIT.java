package com.portfolio.extension.service;

import com.portfolio.extension.dto.IpRuleCreateRequest;
import com.portfolio.extension.dto.IpRuleListResponse;
import com.portfolio.extension.dto.IpRuleResponse;
import com.portfolio.extension.repository.IpAccessRuleRepository;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
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
 * IP 접근 규칙 통합 테스트 - 실제 MySQL 8(Testcontainers), prod 형상(Flyway on + ddl-auto=validate).
 *
 * <p>세 가지를 굳힌다:
 * <ol>
 *   <li><b>스키마 정합</b>: 컨텍스트가 validate 로 뜬다는 것 = V3(DATETIME(6)) 와 엔티티(Instant) 매핑이 일치.</li>
 *   <li><b>UTC 왕복</b>: Instant 를 저장 후 재조회해도 절대 시점이 동일(hibernate.jdbc.time_zone=UTC).
 *       이것이 "디바이스 시간대 렌더" 요건의 서버측 토대.</li>
 *   <li><b>키셋 페이지네이션</b>: 실제 MySQL 에서 다음 페이지가 중복 없이 이어진다.</li>
 * </ol>
 * Docker 필요라 {@code @Tag("integration")} 으로 분리(./gradlew integrationTest).
 */
@Tag("integration")
@Testcontainers
@SpringBootTest
@TestPropertySource(properties = {
        "spring.h2.console.enabled=false",
        "spring.flyway.enabled=true",
        "spring.jpa.hibernate.ddl-auto=validate"
})
class IpAccessRuleMySqlIT {

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
    private IpAccessRuleService service;
    @Autowired
    private IpAccessRuleRepository repository;

    @BeforeEach
    void clean() {
        repository.deleteAll();
    }

    @Test
    void storesAndReadsBackUtcInstant() {
        Instant s = Instant.parse("2024-06-01T00:00:00Z");
        Instant e = Instant.parse("2024-06-05T09:00:00Z");
        service.create(new IpRuleCreateRequest("222.108.193.167", "관리자 접근 IP", s, e));

        IpRuleResponse read = service.list(null, null, null, null, 10).items().get(0);
        assertThat(read.startAt()).isEqualTo(s); // DATETIME(6) <-> Instant UTC 정합
        assertThat(read.endAt()).isEqualTo(e);
    }

    @Test
    void keysetPagination_onMySql_pagesWithoutOverlap() {
        Instant s = Instant.parse("2024-06-01T00:00:00Z");
        for (int i = 0; i < 5; i++) {
            service.create(new IpRuleCreateRequest("10.0.0." + i, "규칙 " + i, s, s.plusSeconds(3600)));
        }
        IpRuleListResponse p1 = service.list(null, null, null, null, 2);
        IpRuleListResponse p2 = service.list(null, null, null, p1.nextCursor(), 2);
        IpRuleListResponse p3 = service.list(null, null, null, p2.nextCursor(), 2);

        List<Long> ids = new ArrayList<>();
        p1.items().forEach(r -> ids.add(r.id()));
        p2.items().forEach(r -> ids.add(r.id()));
        p3.items().forEach(r -> ids.add(r.id()));
        assertThat(ids).hasSize(5).doesNotHaveDuplicates();
        assertThat(p3.hasMore()).isFalse();
    }
}

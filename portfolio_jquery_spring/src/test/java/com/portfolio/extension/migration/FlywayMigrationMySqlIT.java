package com.portfolio.extension.migration;

import com.portfolio.extension.repository.FixedExtensionRepository;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
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
 * #10 마이그레이션 규율 통합 테스트 - 실제 MySQL 8(Testcontainers)에서 실증한다.
 *
 * <p>두 가지를 한 번에 굳힌다:
 * <ol>
 *   <li><b>마이그레이션 적용</b>: Flyway 가 V1(스키마)/V2(시드)를 순서대로 적용하고
 *       {@code flyway_schema_history} 에 이력을 남긴다.</li>
 *   <li><b>스키마 정합(parity)</b>: {@code ddl-auto=validate} 하에서 컨텍스트가 뜬다는 것 자체가
 *       Flyway 로 만든 스키마가 JPA 엔티티 매핑과 일치함을 뜻한다 - #7 에서 Flyway 로 미뤄 둔
 *       손스키마 정합 검증을 여기서 정확히 대신한다.</li>
 * </ol>
 *
 * <p>기본 프로파일(H2)은 {@code spring.flyway.enabled=false} 라 create-drop 으로 돌지만, 이 테스트는
 * 컨테이너 MySQL 로 붙여 Flyway 를 켜고 validate 로 바꾼다(prod 형상과 동일). Docker 필요라
 * {@code @Tag("integration")} 으로 분리한다.
 */
@Tag("integration")
@Testcontainers
@SpringBootTest
@TestPropertySource(properties = {
        "spring.h2.console.enabled=false",
        "spring.flyway.enabled=true",
        "spring.jpa.hibernate.ddl-auto=validate"
})
class FlywayMigrationMySqlIT {

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
    private JdbcTemplate jdbcTemplate;
    @Autowired
    private FixedExtensionRepository fixedExtensionRepository;

    @Test
    void migrationsAreAppliedInOrder() {
        // 컨텍스트가 떴다는 것 = Flyway 적용 + ddl-auto=validate 통과(엔티티-스키마 정합).
        Integer applied = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM flyway_schema_history WHERE success = 1", Integer.class);
        assertThat(applied).isGreaterThanOrEqualTo(6); // V1~V5 + V6 ip_rule_version
    }

    @Test
    void seededFixedExtensionsExist() {
        // V2 마이그레이션이 고정 확장자 7종을 시드한다.
        assertThat(fixedExtensionRepository.count()).isEqualTo(7);
        assertThat(fixedExtensionRepository.existsByName("exe")).isTrue();
    }
}

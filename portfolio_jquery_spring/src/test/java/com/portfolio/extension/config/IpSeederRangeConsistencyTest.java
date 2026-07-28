package com.portfolio.extension.config;

import com.portfolio.extension.service.IpAccessRuleService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 시더↔범위컬럼 정합(#O2, H2). 시더가 대량 삽입할 때 ip_start/ip_end 를 채워, 시딩된 행도
 * /containing(범위 인덱스 조회)에 잡히는지 고정한다(과거엔 시더가 범위를 비워 미포착이었음).
 */
@SpringBootTest(properties = "app.ip-seed.count=200")
class IpSeederRangeConsistencyTest {

    @Autowired
    private IpAccessRuleService service;
    @Autowired
    private JdbcTemplate jdbc;

    @Test
    void seededRows_haveRangeColumns_andAreFoundByContaining() {
        Long total = jdbc.queryForObject("SELECT COUNT(*) FROM ip_access_rule", Long.class);
        assertThat(total).as("시더가 200건 삽입").isGreaterThanOrEqualTo(200L);

        Long nullRanges = jdbc.queryForObject(
                "SELECT COUNT(*) FROM ip_access_rule WHERE ip_start IS NULL OR ip_end IS NULL", Long.class);
        assertThat(nullRanges).as("시더 행은 범위가 전부 채워짐").isZero();

        // 임의의 시더 행 IP 로 조회하면 최소 자기 자신(단일 IP=/32 범위)은 잡힌다.
        String ip = jdbc.queryForObject("SELECT ip_address FROM ip_access_rule LIMIT 1", String.class);
        assertThat(service.findContaining(ip, 30))
                .as("시딩된 IP 가 /containing 에 잡힘: %s", ip)
                .isNotEmpty();
    }
}

package com.portfolio.extension.service;

import com.portfolio.extension.dto.IpRuleCreateRequest;
import com.portfolio.extension.dto.IpRuleResponse;
import com.portfolio.extension.repository.IpAccessRuleRepository;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * CIDR 범위 포함 조회(#I6, H2). ip_start/ip_end 범위 컬럼 + 인덱스로 "이 IP 를 포함하는 규칙" 을
 * 정확히 찾는지 고정한다(IPv4/IPv6, 대역 밖 제외).
 */
@SpringBootTest
class IpRangeQueryTest {

    private static final Instant S = Instant.parse("2024-06-01T00:00:00Z");
    private static final Instant E = Instant.parse("2024-06-02T00:00:00Z");

    @Autowired
    private IpAccessRuleService service;
    @Autowired
    private IpAccessRuleRepository repository;

    @BeforeEach
    void clean() {
        repository.deleteAll();
        service.create(new IpRuleCreateRequest("10.0.0.0/24", "사내망", S, E));
        service.create(new IpRuleCreateRequest("192.168.0.0/16", "사설망", S, E));
        service.create(new IpRuleCreateRequest("2001:db8::/32", "IPv6 대역", S, E));
    }

    @Test
    void findContaining_ipv4_matchesEnclosingRange() {
        List<IpRuleResponse> r = service.findContaining("10.0.0.55", 30);
        assertThat(r).hasSize(1);
        assertThat(r.get(0).ipAddress()).isEqualTo("10.0.0.0/24");
    }

    @Test
    void findContaining_ipv4_matchesBroaderRange() {
        List<IpRuleResponse> r = service.findContaining("192.168.77.9", 30);
        assertThat(r).extracting(IpRuleResponse::ipAddress).containsExactly("192.168.0.0/16");
    }

    @Test
    void findContaining_ipv6() {
        List<IpRuleResponse> r = service.findContaining("2001:db8:abcd::1", 30);
        assertThat(r).extracting(IpRuleResponse::ipAddress).containsExactly("2001:db8::/32");
    }

    @Test
    void findContaining_outsideAllRanges_isEmpty() {
        assertThat(service.findContaining("8.8.8.8", 30)).isEmpty();
        assertThat(service.findContaining("10.0.1.0", 30)).isEmpty(); // 인접 대역 밖
    }
}

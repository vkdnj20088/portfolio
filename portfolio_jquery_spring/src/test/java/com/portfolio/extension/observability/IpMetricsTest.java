package com.portfolio.extension.observability;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * IP 도메인 메트릭 - 계량기 이름/태그와 증가/타이밍을 순수하게(스프링 컨텍스트 없이) 고정한다.
 */
class IpMetricsTest {

    @Test
    void counters_and_timer_areRegisteredAndIncremented() {
        SimpleMeterRegistry reg = new SimpleMeterRegistry();
        IpMetrics m = new IpMetrics(reg);

        m.ruleCreated();
        m.ruleCreated();
        m.ruleDeleted();
        m.recordMatch(true, 1_000);
        m.recordMatch(false, 2_000);
        m.recordMatch(true, 3_000);

        assertThat(reg.get("ip.rule.created").counter().count()).isEqualTo(2.0);
        assertThat(reg.get("ip.rule.deleted").counter().count()).isEqualTo(1.0);
        assertThat(reg.get("ip.match.evaluated").tag("result", "allowed").counter().count()).isEqualTo(2.0);
        assertThat(reg.get("ip.match.evaluated").tag("result", "blocked").counter().count()).isEqualTo(1.0);
        assertThat(reg.get("ip.match.duration").timer().count()).isEqualTo(3L); // 3회 기록
    }
}

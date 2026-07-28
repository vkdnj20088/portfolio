package com.portfolio.extension.observability;

import com.portfolio.extension.observability.FileValidationMetrics.BlockReason;
import com.portfolio.extension.repository.CustomExtensionRepository;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 파일 검증 메트릭(#O1) - 계량기 이름/태그/증가/게이지를 순수하게(컨텍스트 없이) 고정한다.
 * IP 의 IpMetricsTest 와 대칭.
 */
class FileValidationMetricsTest {

    @Test
    void counters_timer_and_gauge() {
        SimpleMeterRegistry reg = new SimpleMeterRegistry();
        CustomExtensionRepository repo = mock(CustomExtensionRepository.class);
        when(repo.count()).thenReturn(3L);
        FileValidationMetrics m = new FileValidationMetrics(reg, repo);

        m.passed(1_000);
        m.blocked(BlockReason.MAGIC, 2_000);
        m.blocked(BlockReason.MAGIC, 2_500);
        m.blocked(BlockReason.POLICY, 3_000);

        assertThat(reg.get("file.validation.total").counter().count()).isEqualTo(4.0);
        assertThat(reg.get("file.validation.passed").counter().count()).isEqualTo(1.0);
        assertThat(reg.get("file.validation.blocked").tag("reason", "magic").counter().count()).isEqualTo(2.0);
        assertThat(reg.get("file.validation.blocked").tag("reason", "policy").counter().count()).isEqualTo(1.0);
        assertThat(reg.get("file.validation.duration").timer().count()).isEqualTo(4L);
        assertThat(reg.get("custom.extension.count").gauge().value()).isEqualTo(3.0);
    }
}

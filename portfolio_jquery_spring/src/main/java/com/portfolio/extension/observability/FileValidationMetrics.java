package com.portfolio.extension.observability;

import com.portfolio.extension.repository.CustomExtensionRepository;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import java.util.concurrent.TimeUnit;
import org.springframework.stereotype.Component;

/**
 * 파일 검증 도메인 메트릭(#O1) - IP 의 {@link IpMetrics} 와 대칭인 관측성 표준을 파일 검증 경로에
 * 이식한다. 계량 지점(서비스)은 이 컴포넌트만 알면 되고 레지스트리 구현에는 의존하지 않는다.
 *
 * <ul>
 *   <li>{@code file.validation.total} - 검증 요청 수(업로드)</li>
 *   <li>{@code file.validation.blocked{reason=magic|content|archive|policy}} - 차단 수(사유별)</li>
 *   <li>{@code file.validation.passed} - 통과 수</li>
 *   <li>{@code file.validation.duration} - 검증 소요 타이머</li>
 *   <li>{@code custom.extension.count} - 현재 커스텀 확장자 수(200 상한을 관측 가능하게)</li>
 * </ul>
 */
@Component
public class FileValidationMetrics {

    public enum BlockReason { MAGIC, CONTENT, ARCHIVE, POLICY }

    private final MeterRegistry registry;
    private final Counter total;
    private final Counter passed;
    private final Timer duration;

    public FileValidationMetrics(MeterRegistry registry, CustomExtensionRepository customRepo) {
        this.registry = registry;
        this.total = Counter.builder("file.validation.total")
                .description("파일 검증 요청 수").register(registry);
        this.passed = Counter.builder("file.validation.passed")
                .description("검증 통과 수").register(registry);
        this.duration = Timer.builder("file.validation.duration")
                .description("파일 검증 소요 시간").register(registry);
        // 200 상한을 관측 가능하게 - 현재 커스텀 확장자 수를 게이지로(레포 count 를 폴링).
        Gauge.builder("custom.extension.count", customRepo, r -> (double) r.count())
                .description("현재 커스텀 차단 확장자 수(상한 200)").register(registry);
    }

    /** 통과 기록(총계 + 통과 + 소요). */
    public void passed(long nanos) {
        total.increment();
        passed.increment();
        duration.record(nanos, TimeUnit.NANOSECONDS);
    }

    /** 차단 기록(총계 + 사유별 차단 + 소요). */
    public void blocked(BlockReason reason, long nanos) {
        total.increment();
        Counter.builder("file.validation.blocked")
                .tag("reason", reason.name().toLowerCase())
                .description("검증 차단 수(사유별)")
                .register(registry)
                .increment();
        duration.record(nanos, TimeUnit.NANOSECONDS);
    }
}

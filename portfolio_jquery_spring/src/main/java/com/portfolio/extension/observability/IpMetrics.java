package com.portfolio.extension.observability;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import java.util.concurrent.TimeUnit;
import org.springframework.stereotype.Component;

/**
 * IP 접근 제어 도메인 메트릭 - Micrometer 계량기를 한곳에 모은다. actuator 의 /metrics 로 노출된다
 * (민감정보 없음). 계량 지점(서비스/컨트롤러)은 이 컴포넌트만 알면 되고, 레지스트리 구현
 * (Simple/Prometheus 등)에는 의존하지 않는다.
 *
 * <ul>
 *   <li>{@code ip.rule.created} / {@code ip.rule.deleted} - 규칙 변경 카운터</li>
 *   <li>{@code ip.match.evaluated{result=allowed|blocked}} - 포함 매칭 결과 카운터</li>
 *   <li>{@code ip.match.duration} - 포함 매칭 소요 타이머</li>
 * </ul>
 */
@Component
public class IpMetrics {

    private final Counter ruleCreated;
    private final Counter ruleDeleted;
    private final Counter matchAllowed;
    private final Counter matchBlocked;
    private final Timer matchTimer;

    public IpMetrics(MeterRegistry registry) {
        this.ruleCreated = Counter.builder("ip.rule.created")
                .description("생성된 IP 접근 규칙 수").register(registry);
        this.ruleDeleted = Counter.builder("ip.rule.deleted")
                .description("삭제된 IP 접근 규칙 수").register(registry);
        this.matchAllowed = Counter.builder("ip.match.evaluated")
                .tag("result", "allowed").description("포함 매칭 판정 수").register(registry);
        this.matchBlocked = Counter.builder("ip.match.evaluated")
                .tag("result", "blocked").description("포함 매칭 판정 수").register(registry);
        this.matchTimer = Timer.builder("ip.match.duration")
                .description("포함 매칭 소요 시간").register(registry);
    }

    public void ruleCreated() {
        ruleCreated.increment();
    }

    public void ruleDeleted() {
        ruleDeleted.increment();
    }

    /** 포함 매칭 결과 + 소요 시간을 한 번에 기록(void 라 목 주입 시에도 안전). */
    public void recordMatch(boolean matched, long nanos) {
        (matched ? matchAllowed : matchBlocked).increment();
        matchTimer.record(nanos, TimeUnit.NANOSECONDS);
    }
}

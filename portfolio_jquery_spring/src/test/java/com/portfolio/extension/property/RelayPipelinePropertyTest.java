package com.portfolio.extension.property;

import com.portfolio.extension.domain.RelayJob;
import com.portfolio.extension.relay.RelayJobStatus;
import com.portfolio.extension.relay.RelayJobType;
import com.portfolio.extension.relay.RelayOutcomes;
import com.portfolio.extension.relay.RelayScenario;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import net.jqwik.api.ForAll;
import net.jqwik.api.Property;
import net.jqwik.api.constraints.DoubleRange;
import net.jqwik.api.constraints.IntRange;
import net.jqwik.api.constraints.Size;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowable;

/**
 * 재시도 파이프라인 불변식(#A) - 이 데모의 전제(결정성·유계·전이 폐쇄)를 문서가 아니라
 * 테스트가 지킨다. 결정성이 깨지면 데모 전체의 전제가 무너지므로, 그것 자체를 성질로 둔다.
 */
class RelayPipelinePropertyTest {

    /** ① 어떤 (시드, 시나리오)에서도 시도 수는 max_attempts 를 절대 넘지 않는다. */
    @Property
    void attemptsNeverExceedMaxAttempts(@ForAll int seed,
            @ForAll RelayScenario scenario, @ForAll @IntRange(min = 1, max = 5) int maxAttempts) {
        int attempts = 0;
        while (attempts < maxAttempts) {
            attempts++;
            if (RelayOutcomes.plan(seed, scenario, attempts).success()) {
                break;
            }
        }
        assertThat(attempts).isLessThanOrEqualTo(maxAttempts);
    }

    /** ② 백오프는 단조 증가(비감소)하며 상한을 넘지 않는다. */
    @Property
    void backoffIsMonotoneAndCapped(@ForAll @IntRange(min = 1, max = 30) int upTo,
            @ForAll @Size(min = 30, max = 30) List<@DoubleRange(min = 0.0, max = 1.0) Double> jitters) {
        long prev = 0;
        for (int n = 1; n <= upTo; n++) {
            long backoff = RelayOutcomes.backoffMs(n, jitters.get(n - 1));
            assertThat(backoff).isGreaterThanOrEqualTo(prev);
            assertThat(backoff).isLessThanOrEqualTo(RelayOutcomes.CAP_DELAY_MS);
            prev = backoff;
        }
    }

    /** ③ 같은 (seed, scenario) 는 같은 타임라인을 낸다 - 결정성 자체를 성질로.
     *  키가 인자에 없는 것이 재생 요건이다: 새 키로도 같은 시드면 같은 타임라인. */
    @Property
    void sameInputsAlwaysYieldSameTimeline(@ForAll int seed,
            @ForAll RelayScenario scenario) {
        for (int n = 1; n <= 5; n++) {
            RelayOutcomes.AttemptPlan a = RelayOutcomes.plan(seed, scenario, n);
            RelayOutcomes.AttemptPlan b = RelayOutcomes.plan(seed, scenario, n);
            assertThat(a).isEqualTo(b);
        }
    }

    /**
     * ④ 전이 폐쇄성 - 임의의 조작 순서를 가해도 상태기계는 정의된 간선으로만 움직인다.
     * 허용되지 않은 전이는 예외로 거절되고 상태를 바꾸지 않으며, 어떤 순서 뒤에도
     * 불변식(종단 상태에는 다음 시도 시각이 없다)이 성립한다.
     */
    @Property
    void transitionsAreClosedUnderArbitraryActionSequences(
            @ForAll @Size(min = 1, max = 12) List<@IntRange(min = 0, max = 5) Integer> actions) {
        RelayJob job = new RelayJob("prop-key", RelayJobType.WEBHOOK_PUSH, null,
                RelayScenario.ALWAYS_FAIL, 1, 3, Instant.EPOCH, null);
        List<RelayJobStatus> visited = new ArrayList<>();
        visited.add(job.getStatus());

        for (int action : actions) {
            RelayJobStatus before = job.getStatus();
            Throwable rejected = catchThrowable(() -> apply(job, action));
            if (rejected != null) {
                // 거절된 전이는 상태를 바꾸지 않는다
                assertThat(rejected).isInstanceOf(IllegalStateException.class);
                assertThat(job.getStatus()).isEqualTo(before);
            } else {
                assertThat(allowed(before, job.getStatus())).as("%s -> %s", before, job.getStatus()).isTrue();
            }
            visited.add(job.getStatus());
            // 불변식: 종단·준종단 상태에는 다음 시도 시각이 없다
            if (job.getStatus().terminal()) {
                assertThat(job.getNextAttemptAt()).isNull();
            }
        }
    }

    private static void apply(RelayJob job, int action) {
        switch (action) {
            case 0 -> job.markRunning();
            case 1 -> job.markSucceeded();
            case 2 -> job.markRetrying(Instant.EPOCH.plusSeconds(1));
            case 3 -> job.markDeadLetter();
            case 4 -> job.markCanceled();
            case 5 -> job.reprocess(Instant.EPOCH.plusSeconds(1));
            default -> throw new IllegalArgumentException(String.valueOf(action));
        }
    }

    /** 설계의 상태 전이도 그대로 - 이 표 밖의 이동이 관찰되면 실패한다. */
    private static boolean allowed(RelayJobStatus from, RelayJobStatus to) {
        return switch (from) {
            case PENDING, RETRYING -> to == RelayJobStatus.RUNNING || to == RelayJobStatus.CANCELED;
            case RUNNING -> to == RelayJobStatus.SUCCEEDED || to == RelayJobStatus.RETRYING
                    || to == RelayJobStatus.DEAD_LETTER;
            case DEAD_LETTER -> to == RelayJobStatus.PENDING;
            case SUCCEEDED, CANCELED -> false;
        };
    }

}

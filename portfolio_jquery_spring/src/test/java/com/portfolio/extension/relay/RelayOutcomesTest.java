package com.portfolio.extension.relay;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 결정적 코어의 예제 테스트 - 시나리오 의미론과 백오프 산식. 성질은 property/ 쪽 jqwik 이 잡는다. */
class RelayOutcomesTest {

    @Test
    void alwaysSucceedSucceedsOnFirstAttempt() {
        RelayOutcomes.AttemptPlan plan = RelayOutcomes.plan(1, RelayScenario.ALWAYS_SUCCEED, 1);
        assertThat(plan.success()).isTrue();
        assertThat(plan.errorCode()).isNull();
        assertThat(plan.backoffMs()).isZero();
    }

    @Test
    void thirdTimeLuckyFailsTwiceThenSucceeds() {
        assertThat(RelayOutcomes.plan(7, RelayScenario.THIRD_TIME_LUCKY, 1).success()).isFalse();
        assertThat(RelayOutcomes.plan(7, RelayScenario.THIRD_TIME_LUCKY, 2).success()).isFalse();
        assertThat(RelayOutcomes.plan(7, RelayScenario.THIRD_TIME_LUCKY, 3).success()).isTrue();
        // 실패 시도에는 사유 코드가 반드시 있다
        assertThat(RelayOutcomes.plan(7, RelayScenario.THIRD_TIME_LUCKY, 1).errorCode()).isNotNull();
    }

    @Test
    void timeoutThenSucceedReportsTimeoutOnFirst() {
        RelayOutcomes.AttemptPlan first = RelayOutcomes.plan(3, RelayScenario.TIMEOUT_THEN_SUCCEED, 1);
        assertThat(first.success()).isFalse();
        assertThat(first.errorCode()).isEqualTo(RelayErrorCode.UPSTREAM_TIMEOUT);
        assertThat(RelayOutcomes.plan(3, RelayScenario.TIMEOUT_THEN_SUCCEED, 2).success()).isTrue();
    }

    @Test
    void flaky5xxOnlyEverReports5xx() {
        for (int n = 1; n <= 10; n++) {
            RelayOutcomes.AttemptPlan plan = RelayOutcomes.plan(42, RelayScenario.FLAKY_5XX, n);
            if (!plan.success()) {
                assertThat(plan.errorCode()).isEqualTo(RelayErrorCode.UPSTREAM_5XX);
            }
        }
    }

    @Test
    void backoffFollowsDocumentedFormula() {
        // 지터 0 이면 정확히 base × 2^(n-1)
        assertThat(RelayOutcomes.backoffMs(1, 0.0)).isEqualTo(1_000L);
        assertThat(RelayOutcomes.backoffMs(2, 0.0)).isEqualTo(2_000L);
        assertThat(RelayOutcomes.backoffMs(3, 0.0)).isEqualTo(4_000L);
        // 지터 최대(1.0)면 지수값의 +25%
        assertThat(RelayOutcomes.backoffMs(2, 1.0)).isEqualTo(2_500L);
        // 상한 - 지수부가 아무리 커도 CAP 을 넘지 않는다
        assertThat(RelayOutcomes.backoffMs(10, 1.0)).isEqualTo(RelayOutcomes.CAP_DELAY_MS);
    }

    @Test
    void rejectsAttemptNoBelowOne() {
        assertThatThrownBy(() -> RelayOutcomes.plan(1, RelayScenario.ALWAYS_SUCCEED, 0))
                .isInstanceOf(IllegalArgumentException.class);
    }
}

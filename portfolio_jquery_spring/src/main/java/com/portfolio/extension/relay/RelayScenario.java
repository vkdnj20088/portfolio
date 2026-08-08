package com.portfolio.extension.relay;

/**
 * 실패 주입 시나리오 - 유한 집합. 작업 실행은 외부 호출이 아니라 이 시나리오를 따르는
 * 내부 시뮬레이션이다(§0: 외부 호출 없음, 화면 배지가 이 사실을 말한다).
 *
 * <p>시도 n 의 성패는 순수 함수 {@code outcome(seed, key, scenario, n)} 로 결정된다
 * ({@link RelayOutcomes}). 같은 (시드, 키, 시나리오)는 항상 같은 타임라인을 낸다.
 */
public enum RelayScenario {
    /** 첫 시도에 성공한다. */
    ALWAYS_SUCCEED,
    /** 1~2회는 실패하고 3회째에 성공한다 - 재시도가 살리는 경우의 표본. */
    THIRD_TIME_LUCKY,
    /** 끝내 실패한다 - 시도 소진 후 격리(DLQ)로 가는 표본. */
    ALWAYS_FAIL,
    /** 첫 시도는 타임아웃, 두 번째에 성공한다. */
    TIMEOUT_THEN_SUCCEED,
    /** 일시적 5xx - 성패가 시드에서 파생된다(같은 시드는 같은 결과). */
    FLAKY_5XX
}

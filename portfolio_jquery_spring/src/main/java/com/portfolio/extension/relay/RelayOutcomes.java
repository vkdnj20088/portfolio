package com.portfolio.extension.relay;

/**
 * 재시도 파이프라인의 결정적 코어 - <b>시도 n 의 성패는 순수 함수다.</b>
 *
 * <pre>outcome(n) = f(seed, scenario, n)</pre>
 *
 * <p>멱등 키는 인자가 아니다. 시드가 기본적으로 키에서 파생되므로(컨트롤러·시더) 작업마다
 * 타임라인이 다르면서도, "같은 시드로 재생"이 <b>새 키로도</b> 같은 타임라인을 낸다 -
 * 키를 성패에 섞으면 키가 UNIQUE 라 재생 자체가 불가능해진다.
 *
 * <ul>
 *   <li>실패 사유와 백오프 지터까지 전부 시드에서 파생된다. 난수가 아니라 파생값이라
 *       같은 (seed, scenario) 는 항상 같은 타임라인을 낸다 - 이 결정성 자체가
 *       jqwik 속성으로 고정된다(문서가 아니라 테스트가 지킨다).</li>
 *   <li>지터를 두는 이유: 백오프 모범사례(동시 재시도 분산). 시드 파생으로 두는 이유:
 *       저장소 원칙(무작위 대신 결정적). 두 요구를 같은 지점에서 만족시킨다.</li>
 *   <li>표시값과 실행값은 같다. 화면에 +2.1s 로 보이면 실제로 2.1s 뒤에 실행된다.
 *       대신 "운영이라면 초·분 단위로 잡는다"는 각주가 화면에 있다 - 표시와 실행이
 *       다르면 그 자체가 거짓말이다.</li>
 * </ul>
 */
public final class RelayOutcomes {

    /** 백오프 기저(1s). 데모 체감용 값이고, 운영 기준은 화면 각주가 말한다. */
    public static final long BASE_DELAY_MS = 1_000L;
    /** 백오프 총 상한. min(지수+지터, 상한) 형태라 어떤 시도도 이를 넘지 않는다. */
    public static final long CAP_DELAY_MS = 10_000L;
    /** 지터 폭 - 지수값의 최대 25%. */
    static final double JITTER_RATIO = 0.25;

    /** 시도 하나의 계획: 성패, 실패 사유(성공이면 null), 다음 시도까지의 대기. */
    public record AttemptPlan(boolean success, RelayErrorCode errorCode, long backoffMs) {
    }

    private RelayOutcomes() {
    }

    /**
     * 시도 n(1기준)의 결과를 계산한다. 실패 시 backoffMs 는 "다음 시도까지 대기"이고,
     * 성공 시 0 이다(다음 시도가 없다).
     */
    public static AttemptPlan plan(int seed, RelayScenario scenario, int attemptNo) {
        if (attemptNo < 1) {
            throw new IllegalArgumentException("attemptNo 는 1 이상: " + attemptNo);
        }
        // 시도별 독립 스트림: 시드와 시도 번호를 섞는다. 골든 상수(황금비 정수)는 시도 간
        // 상관을 끊기 위한 관례값이다. 파생이므로 같은 입력은 언제나 같은 스트림을 얻는다.
        Mulberry32 rng = new Mulberry32(seed ^ (attemptNo * 0x9E3779B9));
        double flavor = rng.next();   // 실패 사유 선택용
        double jitter = rng.next();   // 지터 분수
        double flaky = rng.next();    // FLAKY_5XX 성패용

        boolean success;
        RelayErrorCode error = null;
        switch (scenario) {
            case ALWAYS_SUCCEED -> success = true;
            case THIRD_TIME_LUCKY -> {
                success = attemptNo >= 3;
                if (!success) {
                    error = pickError(flavor);
                }
            }
            case ALWAYS_FAIL -> {
                success = false;
                error = pickError(flavor);
            }
            case TIMEOUT_THEN_SUCCEED -> {
                success = attemptNo >= 2;
                if (!success) {
                    error = RelayErrorCode.UPSTREAM_TIMEOUT;
                }
            }
            case FLAKY_5XX -> {
                success = flaky >= 0.5;
                if (!success) {
                    error = RelayErrorCode.UPSTREAM_5XX;
                }
            }
            default -> throw new IllegalStateException("미정의 시나리오: " + scenario);
        }
        long backoff = success ? 0L : backoffMs(attemptNo, jitter);
        return new AttemptPlan(success, error, backoff);
    }

    /**
     * n회째 실패 후 대기: min(base × 2^(n-1) × (1 + 0.25×jitter분수), cap).
     *
     * <p>지수부가 매 시도 2배씩 늘고 지터가 최대 25%라, 상한 전 구간에서는 항상 이전보다
     * 길다(2×(1+0) ≥ 1×(1+0.25) 이므로 최악 조합에서도 성립). 상한에 닿으면 그 값으로
     * 고정된다 - "단조 증가하며 상한을 넘지 않는다"가 jqwik 속성이다.
     */
    public static long backoffMs(int attemptNo, double jitterFraction) {
        double exp = BASE_DELAY_MS * Math.pow(2, attemptNo - 1);
        double withJitter = exp * (1.0 + JITTER_RATIO * jitterFraction);
        return Math.min(Math.round(withJitter), CAP_DELAY_MS);
    }

    private static RelayErrorCode pickError(double flavor) {
        // TIMEOUT 을 제외한 일반 실패 사유 - 셋 중 시드 파생 선택
        if (flavor < 0.4) {
            return RelayErrorCode.UPSTREAM_TIMEOUT;
        }
        if (flavor < 0.8) {
            return RelayErrorCode.UPSTREAM_5XX;
        }
        return RelayErrorCode.UPSTREAM_CONN_RESET;
    }
}

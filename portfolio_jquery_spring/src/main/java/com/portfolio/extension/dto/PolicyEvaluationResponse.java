package com.portfolio.extension.dto;

import java.time.Instant;
import java.util.List;

/**
 * 정책 평가 결과(#G1) - 판정 + <b>판정 근거</b>.
 *
 * <p>{@code decision} 만 돌려주면 "왜 거부인가"에 답할 수 없다. 접근 제어 화면에서 실제로 필요한
 * 질문은 "허용인가"가 아니라 <b>"내 규칙 중 어느 것이 먹었고 왜 나머지는 안 먹었나"</b>다.
 * 그래서 평가 추적({@code evaluatedRules})을 함께 실어 클라우드 콘솔의 policy simulator 처럼
 * 쓸 수 있게 한다 - 규칙을 고치기 전에 결과를 예측하는 도구가 된다.
 */
public record PolicyEvaluationResponse(
        String target,             // 입력 원문
        String normalizedTarget,   // 정규화 표기
        String family,             // IPV4 | IPV6
        Instant evaluatedAt,       // 이 판정의 기준 시각(시간 창 평가에 쓰인 값)
        String decision,           // ALLOW | DENY (매치 없으면 기본 정책 = DENY)
        EvaluatedRule matchedRule, // 이긴 규칙(없으면 null)
        List<EvaluatedRule> evaluatedRules, // 평가 순서대로의 전체 추적
        String reason) {           // 사람이 읽는 판정 근거 한 문장

    /**
     * 평가된 규칙 한 줄. {@code matched} 는 이 규칙이 조건을 만족했는지, {@code winner} 는 그중
     * 실제로 판정을 결정했는지다 - 여러 규칙이 매치할 수 있고 이기는 것은 하나뿐이라 둘을 분리한다.
     */
    public record EvaluatedRule(
            Long id,
            String ipAddress,
            String description,
            String action,       // ALLOW | DENY
            int priority,
            int prefixLength,    // 특정도 - 동순위 tie-break 근거를 화면에서 설명할 수 있게
            boolean matched,
            boolean winner,
            String skipReason) { // matched=false 인 이유(포함 안 됨 / 기간 밖 / 파싱 불가)
    }
}

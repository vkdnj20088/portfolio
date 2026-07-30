package com.portfolio.extension.service;

import com.portfolio.extension.domain.IpAccessRule;
import com.portfolio.extension.domain.IpAccessRule.Action;
import com.portfolio.extension.dto.PolicyEvaluationResponse;
import java.lang.reflect.Field;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 정책 평가 규칙 고정(#G1). 순수 계산이라 스프링 컨텍스트 없이 돈다.
 *
 * <p>여기서 고정하는 것은 "겹칠 때 무엇이 이기는가"다. 이 규칙이 흔들리면 같은 규칙 집합이
 * 어제와 다른 판정을 내고, 접근 제어에서 그것은 재현되지 않는 장애가 된다.
 */
class IpPolicyEvaluatorTest {

    private static final Instant NOW = Instant.parse("2026-07-30T12:00:00Z");
    private static final Instant FROM = Instant.parse("2026-01-01T00:00:00Z");
    private static final Instant TO = Instant.parse("2027-01-01T00:00:00Z");

    private final IpPolicyEvaluator evaluator = new IpPolicyEvaluator();

    /** id 는 DB 가 채우는 값이라 테스트에서는 리플렉션으로 심는다(평가 순서의 tie-break 근거라 필요). */
    private static IpAccessRule rule(long id, String cidr, Action action, int priority,
            Instant from, Instant to) {
        IpAccessRule r = new IpAccessRule(cidr, "d" + id, from, to, action, priority);
        try {
            Field f = IpAccessRule.class.getDeclaredField("id");
            f.setAccessible(true);
            f.set(r, id);
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException(e);
        }
        return r;
    }

    private static IpAccessRule rule(long id, String cidr, Action action, int priority) {
        return rule(id, cidr, action, priority, FROM, TO);
    }

    @Test
    @DisplayName("매치하는 규칙이 없으면 기본 정책은 거부다")
    void defaultDeny() {
        PolicyEvaluationResponse r = evaluator.evaluate("203.0.113.9", List.of(), NOW);
        assertThat(r.decision()).isEqualTo("DENY");
        assertThat(r.matchedRule()).isNull();
        assertThat(r.reason()).contains("기본 정책");
    }

    @Test
    @DisplayName("ALLOW 규칙 하나면 허용 - action 도입 전과 같은 판정(마이그레이션 동치)")
    void singleAllowMatchesLegacyBehaviour() {
        PolicyEvaluationResponse r = evaluator.evaluate("10.1.2.3",
                List.of(rule(1, "10.0.0.0/8", Action.ALLOW, IpAccessRule.DEFAULT_PRIORITY)), NOW);
        assertThat(r.decision()).isEqualTo("ALLOW");
        assertThat(r.matchedRule().id()).isEqualTo(1L);
    }

    @Test
    @DisplayName("작은 priority 가 먼저 평가되고 첫 매치가 이긴다")
    void lowerPriorityWinsFirst() {
        PolicyEvaluationResponse r = evaluator.evaluate("10.1.2.3", List.of(
                rule(1, "10.0.0.0/8", Action.ALLOW, 100),
                rule(2, "10.0.0.0/8", Action.DENY, 10)), NOW);
        assertThat(r.decision()).isEqualTo("DENY");
        assertThat(r.matchedRule().id()).isEqualTo(2L);
        // 추적에는 둘 다 남고, 이긴 쪽만 winner 다 - "왜 다른 규칙은 안 먹었나"에 답할 수 있어야 한다.
        assertThat(r.evaluatedRules()).hasSize(2);
        assertThat(r.evaluatedRules().stream().filter(PolicyEvaluationResponse.EvaluatedRule::matched))
                .hasSize(2);
        assertThat(r.evaluatedRules().stream().filter(PolicyEvaluationResponse.EvaluatedRule::winner))
                .hasSize(1);
    }

    @Test
    @DisplayName("동순위면 더 좁은 규칙(긴 prefix)이 먼저 - 예외가 일반보다 먼저 평가돼야 한다")
    void narrowerWinsOnTie() {
        PolicyEvaluationResponse r = evaluator.evaluate("10.1.2.3", List.of(
                rule(1, "10.0.0.0/8", Action.ALLOW, 100),
                rule(2, "10.1.2.3/32", Action.DENY, 100)), NOW);
        assertThat(r.decision()).isEqualTo("DENY");
        assertThat(r.matchedRule().prefixLength()).isEqualTo(32);
    }

    @Test
    @DisplayName("priority 가 특정도보다 우선한다 - 넓은 규칙도 우선순위가 낮으면 먼저 이긴다")
    void priorityBeatsSpecificity() {
        PolicyEvaluationResponse r = evaluator.evaluate("10.1.2.3", List.of(
                rule(1, "10.0.0.0/8", Action.ALLOW, 1),
                rule(2, "10.1.2.3/32", Action.DENY, 100)), NOW);
        assertThat(r.decision()).isEqualTo("ALLOW");
        assertThat(r.matchedRule().id()).isEqualTo(1L);
    }

    @Test
    @DisplayName("우선순위·특정도가 같으면 낮은 id 가 이긴다 - 판정이 결정적이어야 한다")
    void stableByIdWhenFullyTied() {
        List<IpAccessRule> a = List.of(
                rule(7, "10.0.0.0/8", Action.DENY, 100),
                rule(3, "10.0.0.0/8", Action.ALLOW, 100));
        List<IpAccessRule> b = List.of(
                rule(3, "10.0.0.0/8", Action.ALLOW, 100),
                rule(7, "10.0.0.0/8", Action.DENY, 100));
        // 입력 순서가 달라도 같은 판정 - 정렬이 안정적이지 않으면 여기서 갈린다.
        assertThat(evaluator.evaluate("10.1.2.3", a, NOW).matchedRule().id()).isEqualTo(3L);
        assertThat(evaluator.evaluate("10.1.2.3", b, NOW).matchedRule().id()).isEqualTo(3L);
    }

    @Test
    @DisplayName("기간 밖 규칙은 매치하지 않고, 왜 건너뛰었는지 추적에 남는다")
    void outOfWindowSkippedWithReason() {
        PolicyEvaluationResponse r = evaluator.evaluate("10.1.2.3", List.of(
                rule(1, "10.0.0.0/8", Action.ALLOW, 100,
                        Instant.parse("2020-01-01T00:00:00Z"), Instant.parse("2021-01-01T00:00:00Z"))), NOW);
        assertThat(r.decision()).isEqualTo("DENY");
        assertThat(r.evaluatedRules()).singleElement()
                .satisfies(row -> {
                    assertThat(row.matched()).isFalse();
                    assertThat(row.skipReason()).isEqualTo("사용 기간이 끝났습니다");
                });
    }

    @Test
    @DisplayName("시작 전 규칙도 건너뛴다 - 미래 시점으로 물으면 허용으로 바뀐다(예측 도구)")
    void beforeStartSkippedButAllowedLater() {
        Instant future = Instant.parse("2026-09-01T00:00:00Z");
        IpAccessRule r1 = rule(1, "10.0.0.0/8", Action.ALLOW, 100,
                Instant.parse("2026-08-15T00:00:00Z"), TO);
        assertThat(evaluator.evaluate("10.1.2.3", List.of(r1), NOW).decision()).isEqualTo("DENY");
        assertThat(evaluator.evaluate("10.1.2.3", List.of(r1), NOW).evaluatedRules()
                .getFirst().skipReason()).isEqualTo("사용 시작 전입니다");
        assertThat(evaluator.evaluate("10.1.2.3", List.of(r1), future).decision()).isEqualTo("ALLOW");
    }

    @Test
    @DisplayName("대상을 포함하지 않는 규칙은 사유와 함께 남는다")
    void notContainingSkipped() {
        PolicyEvaluationResponse r = evaluator.evaluate("192.0.2.1", List.of(
                rule(1, "10.0.0.0/8", Action.ALLOW, 100)), NOW);
        assertThat(r.decision()).isEqualTo("DENY");
        assertThat(r.evaluatedRules().getFirst().skipReason()).isEqualTo("대상 IP 를 포함하지 않습니다");
    }

    @Test
    @DisplayName("IPv6 도 같은 규칙으로 평가된다")
    void ipv6() {
        PolicyEvaluationResponse r = evaluator.evaluate("2001:db8::5", List.of(
                rule(1, "2001:db8::/32", Action.ALLOW, 100),
                rule(2, "2001:db8::5/128", Action.DENY, 100)), NOW);
        assertThat(r.family()).isEqualTo("IPV6");
        assertThat(r.decision()).isEqualTo("DENY"); // 더 좁은 /128 이 동순위에서 먼저
    }
}

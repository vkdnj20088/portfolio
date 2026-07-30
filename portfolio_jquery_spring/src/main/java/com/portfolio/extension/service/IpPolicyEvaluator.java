package com.portfolio.extension.service;

import com.portfolio.extension.domain.IpAccessRule;
import com.portfolio.extension.dto.PolicyEvaluationResponse;
import com.portfolio.extension.dto.PolicyEvaluationResponse.EvaluatedRule;
import com.portfolio.extension.net.IpCidr;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import org.springframework.stereotype.Component;

/**
 * 정책 평가 - "이 IP 는 지금 허용되나, 그리고 <b>왜</b> 그런가"(#G1).
 *
 * <h2>왜 별도 컴포넌트인가</h2>
 * 규칙을 저장하고 목록으로 보여 주는 것은 CRUD 다. 접근 제어의 어려운 부분은 <b>규칙이 겹칠 때
 * 무엇이 이기는지</b> 정하는 쪽이고, 그 판단이 코드 곳곳에 흩어지면 같은 입력에 다른 답이 나온다.
 * 평가를 한 클래스에 모으고 그 클래스가 <b>판정 근거까지 반환</b>하게 하면, 화면은 결과만
 * 보여 주는 것이 아니라 "3번 규칙이 2번보다 먼저 평가돼 이겼다"를 설명할 수 있다 -
 * 클라우드 콘솔의 policy simulator 가 하는 일이 이것이다.
 *
 * <h2>평가 규칙</h2>
 * <ol>
 *   <li>{@code priority} 오름차순 - 작은 값이 먼저. <b>첫 매치가 이긴다</b>(iptables/ACL 관례).</li>
 *   <li>동순위면 <b>prefix 가 긴 쪽</b>(더 좁은 규칙)이 먼저 - 예외가 일반보다 먼저 평가돼야
 *       의미가 있다. 반대로 두면 넓은 규칙이 늘 먼저 이겨 좁은 예외를 쓸 수 없다.</li>
 *   <li>그래도 같으면 {@code id} 오름차순 - 결정성. 같은 규칙 집합에 같은 질의는 늘 같은 판정을
 *       내야 한다(정렬이 불안정하면 재현되지 않는 접근 거부가 생긴다).</li>
 * </ol>
 *
 * <p><b>기본값은 거부</b>다. 아무 규칙도 매치하지 않으면 DENY - 접근 제어의 안전한 기본값은
 * "명시적으로 허용한 것만 허용"이다. 규칙 집합이 비어 있을 때 전부 허용되는 설계는 마이그레이션
 * 실패나 DB 초기화 사고가 곧 전면 개방이 된다.
 *
 * <p><b>시간 창</b>은 매치 조건에 포함한다. 기간이 지난 규칙은 "매치했지만 만료" 가 아니라
 * 애초에 매치하지 않는다 - 다만 평가 추적에는 왜 건너뛰었는지를 남겨(skipReason) 사용자가
 * "규칙은 있는데 왜 거부인가"를 알 수 있게 한다.
 */
@Component
public class IpPolicyEvaluator {

    /**
     * 평가 순서 비교자. DB 인덱스(idx_ip_rule_policy)와 같은 순서지만, 정렬의 단일 진실원은
     * 여기다 - 인메모리 평가와 DB 정렬이 갈리면 설명과 판정이 어긋난다.
     */
    private static final Comparator<IpAccessRule> ORDER = Comparator
            .comparingInt(IpAccessRule::getPriority)
            .thenComparing(Comparator.comparingInt(IpPolicyEvaluator::prefixLength).reversed())
            .thenComparing(IpAccessRule::getId, Comparator.nullsLast(Comparator.naturalOrder()));

    private static int prefixLength(IpAccessRule rule) {
        try {
            return IpCidr.parse(rule.getIpAddress()).prefixLen();
        } catch (RuntimeException e) {
            // 파싱 실패는 저장 시점에 막히지만, 방어적으로 가장 낮은 특정도로 취급한다
            // (평가가 예외로 죽으면 접근 제어 전체가 멈춘다 - 거부보다 나쁜 상태다).
            return 0;
        }
    }

    /**
     * 규칙 집합 전체를 대상 IP 에 대해 평가한다.
     *
     * @param candidates 대상 IP 를 <b>포함할 수 있는</b> 규칙들(범위 인덱스로 좁혀 넘기면 되고,
     *                   전체를 넘겨도 결과는 같다 - 포함 판정을 여기서 다시 하기 때문)
     */
    public PolicyEvaluationResponse evaluate(String target, List<IpAccessRule> candidates, Instant at) {
        IpCidr t = IpCidr.parse(target);
        List<IpAccessRule> ordered = new ArrayList<>(candidates);
        ordered.sort(ORDER);

        List<EvaluatedRule> trace = new ArrayList<>(ordered.size());
        EvaluatedRule winner = null;

        for (IpAccessRule rule : ordered) {
            String skipReason = null;
            boolean contains;
            try {
                contains = IpCidr.parse(rule.getIpAddress()).contains(t);
            } catch (RuntimeException e) {
                contains = false;
                skipReason = "규칙의 IP/CIDR 을 해석할 수 없습니다";
            }
            if (skipReason == null && !contains) {
                skipReason = "대상 IP 를 포함하지 않습니다";
            } else if (skipReason == null && at.isBefore(rule.getStartAt())) {
                skipReason = "사용 시작 전입니다";
            } else if (skipReason == null && at.isAfter(rule.getEndAt())) {
                skipReason = "사용 기간이 끝났습니다";
            }

            boolean matched = skipReason == null;
            EvaluatedRule row = new EvaluatedRule(
                    rule.getId(), rule.getIpAddress(), rule.getDescription(),
                    rule.getAction().name(), rule.getPriority(), prefixLength(rule),
                    matched, matched && winner == null, skipReason);
            trace.add(row);
            if (matched && winner == null) {
                winner = row;
            }
            // 첫 매치에서 멈추지 않고 끝까지 훑는 이유: 판정은 이미 정해졌지만 사용자는 "왜 다른
            // 규칙은 안 먹었나"를 알아야 한다. 규칙 수가 후보로 좁혀져 있어 비용이 작다.
        }

        String decision = winner != null ? winner.action() : IpAccessRule.Action.DENY.name();
        String reason = winner != null
                ? "우선순위 %d, /%d 규칙 #%d 가 먼저 매치해 %s 로 판정했습니다."
                        .formatted(winner.priority(), winner.prefixLength(), winner.id(), winner.action())
                : "매치하는 규칙이 없어 기본 정책(거부)을 적용했습니다.";

        return new PolicyEvaluationResponse(target, t.canonical(), t.family().name(), at,
                decision, winner, trace, reason);
    }
}

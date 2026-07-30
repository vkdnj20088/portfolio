-- 정책 평가(#G1). 직전까지 규칙은 "허용 목록"뿐이었다: 규칙에 걸리면 허용, 아니면 아님.
-- 그 모델에서는 규칙이 겹쳐도 결과가 늘 같아서(허용 ∪ 허용 = 허용) 우선순위가 장식이 된다.
--
-- action 을 더해 DENY 를 표현할 수 있게 하면 그때부터 "겹칠 때 무엇이 이기는가"가 실제 문제가 된다:
-- 넓은 ALLOW(10.0.0.0/8) 안에서 좁은 DENY(10.1.2.3/32)로 예외를 파내는 것이 방화벽·IAM·
-- NetworkPolicy 가 공통으로 다루는 형태다. 그 평가 순서를 명시하는 것이 priority 의 존재 이유다.
--
-- 평가 규칙(IpPolicyEvaluator 와 반드시 일치):
--   1) priority 오름차순 - 작은 값이 먼저 평가되고 first match wins (iptables/ACL 관례)
--   2) 동순위면 prefix 가 긴 쪽(더 좁은 규칙)이 먼저 - 예외가 일반보다 먼저 평가돼야 의미가 있다
--   3) 그래도 같으면 id 오름차순 - 결정성 보장(같은 입력이 늘 같은 판정을 내야 한다)
--
-- 기존 행은 전부 ALLOW / priority 100 을 받는다. 규칙이 하나뿐인 집합에서는 판정이 이전과 같으므로
-- 마이그레이션 전후 결정이 바뀌지 않는다(IpPolicyEvaluatorTest 가 이 동치를 고정한다).
ALTER TABLE ip_access_rule
    ADD COLUMN action   VARCHAR(8) NOT NULL DEFAULT 'ALLOW',
    ADD COLUMN priority INT        NOT NULL DEFAULT 100;

-- 평가 순서 그대로의 인덱스. 전체 규칙을 정렬해 훑는 질의가 파일소트를 타지 않게 한다.
-- (범위 포함 조회는 idx_ip_range 가 담당하고, 이 인덱스는 "순서"를 담당한다.)
CREATE INDEX idx_ip_rule_policy ON ip_access_rule (priority, id);

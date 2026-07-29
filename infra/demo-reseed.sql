-- 공개 데모의 표본 데이터 복구. portfolio-demo-reseed.timer 가 한 시간마다 실행한다.
--
-- 왜 필요한가: 두 화면의 쓰기 API 는 무인증이다. 평가자가 직접 만져 봐야 의미가 있는 데모라
-- 그렇게 두었지만, 되돌릴 길이 없으면 상태가 한 방향으로만 나빠진다. 누군가 규칙을 전부 지우면
-- 다음 방문자는 빈 화면을 본다.
--
-- 설계 원칙 두 가지:
--   1) 초기화가 아니라 복구다. 방문자가 만든 행을 즉시 지우면, 지금 화면을 보고 있는 사람의
--      작업이 눈앞에서 사라진다. 없어진 표본만 되살리고, 방문자가 만든 것은 24시간 뒤에 치운다.
--   2) 여러 번 돌려도 같은 결과여야 한다(멱등). 타이머는 실패하면 다시 돌고, 재실행이
--      안전하지 않으면 그 자체가 사고가 된다.
--
-- 표본 IP 는 RFC 5737(203.0.113.0/24, 198.51.100.0/24)과 RFC 3849(2001:db8::/32)의
-- **문서화 전용 대역**을 쓴다. 실존 호스트를 가리키지 않으면서 IPv4 / CIDR 대역 / IPv6 세 가지
-- 표기를 한 화면에 보여 준다.

-- ── 1) 고정 확장자: 차단 상태를 기준선으로 되돌린다 ──────────────────────────
-- 행 자체는 지워지지 않는다(API 가 토글만 허용). 흩어지는 것은 is_blocked 뿐이다.
--
-- version 을 함께 올리는 이유: 이 컬럼은 JPA @Version(낙관적 락)이다. SQL 로 is_blocked 만
-- 바꾸고 version 을 그대로 두면, 화면을 열어 둔 채 낡은 버전을 들고 있던 요청이 이 복구를
-- 모른 채 그대로 덮어쓴다. 올려 두면 그 요청은 충돌로 거절된다 - 락을 우회하지 않는다.
UPDATE fixed_extension
   SET is_blocked = (name IN ('com', 'exe')),
       version    = version + 1
 WHERE is_blocked <> (name IN ('com', 'exe'));

-- ── 2) 커스텀 확장자: 없어진 표본만 되살린다 ────────────────────────────────
-- name 이 UNIQUE 라 ON DUPLICATE KEY UPDATE 로 재실행이 안전하다(값은 건드리지 않는다).
INSERT INTO custom_extension (name) VALUES ('doc'), ('xls'), ('pdf'), ('sh')
    ON DUPLICATE KEY UPDATE name = name;

-- 방문자가 추가한 것은 하루 지난 뒤 치운다. 상한이 200 이라 그냥 두면 언젠가 등록이 막힌다.
DELETE FROM custom_extension
 WHERE name NOT IN ('doc', 'xls', 'pdf', 'sh')
   AND created_at < NOW() - INTERVAL 24 HOUR;

-- ── 3) IP 규칙: 없어진 표본만 되살린다 ──────────────────────────────────────
-- ip_address 에 UNIQUE 가 없어(같은 IP 를 기간을 달리해 여러 건 두는 것이 정상) ON DUPLICATE
-- KEY 를 쓸 수 없다. 존재 확인 후 넣는다.
--
-- 사용 기간을 실행 시각 기준으로 잡는 이유: 고정 날짜로 심으면 시간이 지나 표본이 전부 만료된
-- 상태로 보인다. 실제로 그렇게 되어 있었다.
INSERT INTO ip_access_rule (ip_address, description, start_at, end_at, created_at)
SELECT s.ip, s.descr,
       NOW(6) - INTERVAL 1 DAY,
       NOW(6) + INTERVAL 30 DAY,
       NOW(6)
  FROM (
        SELECT '203.0.113.10'     AS ip, '본사 사무실'    AS descr
  UNION ALL SELECT '198.51.100.0/24',    '지사 대역'
  UNION ALL SELECT '2001:db8::1',        'IPv6 게이트웨이'
       ) AS s
 WHERE NOT EXISTS (SELECT 1 FROM ip_access_rule r WHERE r.ip_address = s.ip);

DELETE FROM ip_access_rule
 WHERE ip_address NOT IN ('203.0.113.10', '198.51.100.0/24', '2001:db8::1')
   AND created_at < NOW(6) - INTERVAL 24 HOUR;

-- ── 4) 감사 로그: 오래된 것만 잘라낸다 ──────────────────────────────────────
-- append-only 가 이 기능의 요점이라 내용은 손대지 않는다. 다만 2GB 인스턴스에서 무한히
-- 자라게 둘 수는 없어 보존 기간만 둔다. 30일이면 데모에서 보여 줄 이력으로 충분하다.
DELETE FROM ip_audit_log WHERE created_at < NOW(6) - INTERVAL 30 DAY;

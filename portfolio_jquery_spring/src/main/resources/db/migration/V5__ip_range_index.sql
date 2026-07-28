-- CIDR 범위 조회 인덱스(#I6). 규칙의 IP/CIDR 을 16바이트 정규화(IPv4 는 IPv4-mapped) 시작/끝 주소로
-- 저장하고, (ip_start, ip_end) 복합 인덱스로 "이 IP 를 포함하는 규칙" 을 인덱스 조회한다:
--   WHERE ip_start <= X AND ip_end >= X
-- 불투명 문자열 LIKE 로는 불가능한 대역 포함(containment) 질의를 인덱스 범위 스캔으로 만든다.
-- 신규 행은 엔티티(생성자)·시더(#O2) 모두 범위를 채운다. 이 마이그레이션 이전에 이미 존재하던
-- 행만 NULL 로 남는데(이 데모는 prod 초기 배포라 해당 없음), 그런 경우 아래 backfill 로 채운다:
--   (앱단에서 IpCidr 로 재계산해 UPDATE - SQL 만으론 IPv6/CIDR 정규화가 어려워 코드 백필을 권장)
ALTER TABLE ip_access_rule
    ADD COLUMN ip_start VARBINARY(16) NULL,
    ADD COLUMN ip_end   VARBINARY(16) NULL;

CREATE INDEX idx_ip_range ON ip_access_rule (ip_start, ip_end);

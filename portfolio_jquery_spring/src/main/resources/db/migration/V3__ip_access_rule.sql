-- 허용 IP 접근 규칙(어드민). 시각은 UTC 절대 시점을 DATETIME(6) 에 저장한다
-- (hibernate.jdbc.time_zone=UTC 로 Instant <-> DATETIME 를 UTC 로 정합). Flyway 는 prod(MySQL)에서만 실행.
CREATE TABLE ip_access_rule (
    id          BIGINT       PRIMARY KEY AUTO_INCREMENT,
    ip_address  VARCHAR(45)  NOT NULL,                       -- IPv6 최대 길이 대비
    description VARCHAR(20)  NOT NULL,                        -- 설명 최대 20자
    start_at    DATETIME(6)  NOT NULL,                       -- 사용 시작(UTC)
    end_at      DATETIME(6)  NOT NULL,                        -- 사용 끝(UTC)
    created_at  DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) -- 등록 시각(UTC)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- 목록: 등록시간 내림차순 키셋 페이지네이션(+id 안정 정렬). 100만 행 페이지 이동을 인덱스로 상수화.
CREATE INDEX idx_ip_rule_created ON ip_access_rule (created_at DESC, id DESC);
-- 기간 검색: 사용 시작/끝 범위 필터.
CREATE INDEX idx_ip_rule_start ON ip_access_rule (start_at);
CREATE INDEX idx_ip_rule_end ON ip_access_rule (end_at);
-- 내용(설명) 검색은 LIKE '%..%' 라 인덱스를 못 탄다(풀스캔). 접두검색 'q%' 나 FULLTEXT 인덱스로
-- 개선 가능하나, 부분일치 요건상 트레이드오프를 README 에 명시하고 이 데모는 부분일치를 유지한다.

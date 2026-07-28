-- IP 접근 규칙 변경 감사 로그(append-only). 누가(actor)/언제(created_at, UTC)/무엇(action, rule_id,
-- ip_address 스냅샷)을 남긴다. 규칙이 삭제돼도 이력은 보존하므로 FK 를 두지 않는다. Flyway 는 prod 만.
CREATE TABLE ip_audit_log (
    id          BIGINT       PRIMARY KEY AUTO_INCREMENT,
    action      VARCHAR(10)  NOT NULL,                        -- CREATE | DELETE
    rule_id     BIGINT       NULL,                            -- 대상 규칙 id(FK 없음: 삭제돼도 이력 보존)
    ip_address  VARCHAR(45)  NULL,                            -- 변경 시점의 규칙 IP 스냅샷
    actor       VARCHAR(45)  NOT NULL,                        -- 행위자(데모: 요청 원격주소)
    created_at  DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) -- 기록 시각(UTC)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- 목록: 규칙과 동일한 등록시간 내림차순 키셋(+id 안정 정렬).
CREATE INDEX idx_ip_audit_created ON ip_audit_log (created_at DESC, id DESC);

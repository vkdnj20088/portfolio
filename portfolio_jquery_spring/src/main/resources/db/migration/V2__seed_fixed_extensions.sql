-- 고정 확장자 7종 시드(멱등). 애플리케이션 DataInitializer 와 동일한 목록으로,
-- prod 에서는 Flyway 가 이 시드를 소유하고 DataInitializer 는 존재 확인 후 무연산(이중 방어).
INSERT INTO fixed_extension (name, is_blocked) VALUES
    ('bat', false), ('cmd', false), ('com', false), ('cpl', false),
    ('exe', false), ('scr', false), ('js', false)
ON DUPLICATE KEY UPDATE name = name;   -- 재적용/기존 데이터와 충돌 없이 통과

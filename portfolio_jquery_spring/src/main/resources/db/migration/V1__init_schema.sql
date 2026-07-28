-- 초기 스키마. 손관리 db/mysql-schema.sql 을 대체하는 버전관리 마이그레이션(#10).
-- 타입/제약은 JPA 엔티티 매핑과 정합해야 prod 의 ddl-auto=validate 를 통과한다
-- (엔티티가 진실원, 이 파일은 그 반영이며 FlywayMigrationMySqlIT 가 CI 에서 정합을 실증한다).

CREATE TABLE fixed_extension (
    id          BIGINT       PRIMARY KEY AUTO_INCREMENT,
    name        VARCHAR(20)  NOT NULL UNIQUE,
    is_blocked  BOOLEAN      NOT NULL DEFAULT FALSE,
    version     BIGINT       NOT NULL DEFAULT 0,   -- @Version 낙관적 락(동시 토글 로스트 업데이트 방지)
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                             ON UPDATE CURRENT_TIMESTAMP
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE custom_extension (
    id          BIGINT       PRIMARY KEY AUTO_INCREMENT,
    name        VARCHAR(20)  NOT NULL UNIQUE,   -- 동시성 중복의 최후 방어선
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

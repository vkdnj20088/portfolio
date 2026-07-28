-- 부분수정(PUT) 낙관적 락(#Q2). @Version 컬럼을 더해 동시 수정의 로스트 업데이트를 차단한다.
-- NOT NULL DEFAULT 0 - 기존 행은 0 을 기준 버전으로 받고, 엔티티(@Version)의 NOT NULL DDL 과 정합한다.
ALTER TABLE ip_access_rule ADD COLUMN version BIGINT NOT NULL DEFAULT 0;

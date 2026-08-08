-- 작업 재시도 파이프라인(#A). "실패하는 작업을 잃지도 않고, 무한히 붙잡지도 않는다"의
-- 저장 구조다. 시각은 다른 테이블과 같이 UTC 절대 시점을 DATETIME(6) 에 둔다.
--
-- relay_job     작업 원장. 멱등 키 UNIQUE 가 중복 예약의 마지막 방어선이다(애플리케이션
--               검사보다 아래층). 성패는 저장된 (seed, idempotency_key, scenario) 에서
--               파생되는 순수 함수라, 행이 곧 재현 가능한 타임라인의 씨앗이다.
-- relay_attempt 시도 이력(append-only). UNIQUE(job_id, run, attempt_no) 가 워커 중복 실행이
--               이력을 겹쳐 쓰는 것을 DB 차원에서 거절한다. run 은 재처리 세대다 -
--               append-only 와 "재처리 후 1회부터 다시"가 공존하려면 세대 축이 필요하다.
-- relay_outbox  아웃박스. 원본 변경과 같은 트랜잭션으로 적재하고 발행기가 커밋된 행만
--               발행한다. 집계 키가 job id 가 아니라 멱등 키인 이유: 비교 데모의
--               "직접 발행 + 저장 실패" 경로에서는 작업 insert 가 롤백돼 id 가 존재한
--               적이 없다 - 유령 이벤트("짝 없는 발행")를 세려면 자연 키가 필요하다.

CREATE TABLE relay_job (
    id              BIGINT       PRIMARY KEY AUTO_INCREMENT,
    idempotency_key VARCHAR(64)  NOT NULL,
    type            VARCHAR(32)  NOT NULL,                    -- RelayJobType (enum 문자열)
    payload         VARCHAR(255) NULL,
    status          VARCHAR(20)  NOT NULL,                    -- RelayJobStatus
    attempt_count   INT          NOT NULL DEFAULT 0,
    max_attempts    INT          NOT NULL,
    seed            INT          NOT NULL,                    -- 결정적 실패 주입 시드(화면 노출)
    scenario        VARCHAR(32)  NOT NULL,                    -- RelayScenario
    run             INT          NOT NULL DEFAULT 0,          -- 재처리 세대(0부터)
    next_attempt_at DATETIME(6)  NULL,                        -- PENDING/RETRYING 에서만 의미
    enqueue_cid     VARCHAR(64)  NULL,                        -- 예약 요청 상관 ID(비동기 경계 전파)
    version         BIGINT       NOT NULL DEFAULT 0,          -- 낙관적 락(취소/재처리 vs 워커 경합)
    created_at      DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at      DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    CONSTRAINT uq_relay_job_idem UNIQUE (idempotency_key)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- 워커 리스 후보 조회: WHERE status IN(...) AND next_attempt_at <= now ORDER BY next_attempt_at.
-- 집을 후보만 훑는다 - IP 데모의 범위 인덱스와 같은 사고(질의 모양대로 인덱스를 세운다).
CREATE INDEX idx_relay_job_ready ON relay_job (status, next_attempt_at);
-- 최근 작업 목록(등록 역순).
CREATE INDEX idx_relay_job_created ON relay_job (created_at DESC, id DESC);

CREATE TABLE relay_attempt (
    id          BIGINT      PRIMARY KEY AUTO_INCREMENT,
    job_id      BIGINT      NOT NULL,
    run         INT         NOT NULL DEFAULT 0,               -- 재처리 세대
    attempt_no  INT         NOT NULL,
    started_at  DATETIME(6) NOT NULL,
    finished_at DATETIME(6) NOT NULL,
    success     BOOLEAN     NOT NULL,
    error_code  VARCHAR(32) NULL,                             -- RelayErrorCode (성공이면 NULL)
    backoff_ms  BIGINT      NOT NULL DEFAULT 0,               -- 다음 시도까지 대기(성공이면 0)
    cid         VARCHAR(64) NULL,                             -- 이 시도를 실행한 워커 상관 ID
    CONSTRAINT uq_relay_attempt UNIQUE (job_id, run, attempt_no),
    CONSTRAINT fk_relay_attempt_job FOREIGN KEY (job_id) REFERENCES relay_job (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE relay_outbox (
    id            BIGINT       PRIMARY KEY AUTO_INCREMENT,
    aggregate_key VARCHAR(64)  NOT NULL,                      -- 작업 멱등 키(자연 키)
    event_type    VARCHAR(32)  NOT NULL,                      -- JOB_ENQUEUED / JOB_FINISHED
    payload       VARCHAR(255) NULL,
    published_at  DATETIME(6)  NULL,                          -- NULL = 미발행(발행기 대기)
    created_at    DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- 발행기 조회: WHERE published_at IS NULL ORDER BY id. 미발행분만 인덱스로 집는다.
CREATE INDEX idx_relay_outbox_unpublished ON relay_outbox (published_at, id);
-- 유령 판정("relay_job 에 짝이 없는 발행 이벤트")의 조인 키.
CREATE INDEX idx_relay_outbox_aggregate ON relay_outbox (aggregate_key);

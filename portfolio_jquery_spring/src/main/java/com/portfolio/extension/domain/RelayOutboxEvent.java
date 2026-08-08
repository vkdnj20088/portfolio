package com.portfolio.extension.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import org.hibernate.annotations.CreationTimestamp;

/**
 * 아웃박스 이벤트. 원본 변경과 <b>같은 트랜잭션</b>으로 이 테이블에 적재하고, 발행기가
 * 커밋된 행만 뒤따라 발행한다(published_at 스탬프). 트랜잭션이 구르면 이벤트도 함께
 * 구른다 - "원본은 없는데 이벤트만 나가는" 유령이 원리적으로 안 생긴다.
 *
 * <p>집계 식별자는 job id 가 아니라 <b>멱등 키</b>다. 비교 데모의 "직접 발행 + 저장 실패"
 * 경로에서는 작업 insert 가 롤백돼 id 가 존재한 적이 없다 - 유령 이벤트를 저장하려면
 * 트랜잭션 밖에서도 유효한 자연 키가 필요하다. 유령 카운트는 "relay_job 에 짝이 없는
 * 발행 이벤트 수"로 정의된다.
 */
@Entity
@Table(name = "relay_outbox")
public class RelayOutboxEvent {

    public static final String TYPE_ENQUEUED = "JOB_ENQUEUED";
    public static final String TYPE_FINISHED = "JOB_FINISHED";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** 집계 자연 키 = 작업 멱등 키. */
    @Column(name = "aggregate_key", nullable = false, length = 64)
    private String aggregateKey;

    @Column(name = "event_type", nullable = false, length = 32)
    private String eventType;

    @Column(length = 255)
    private String payload;

    /** NULL = 미발행(발행기 대기). 값이 있으면 발행 완료. */
    @Column(name = "published_at")
    private Instant publishedAt;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected RelayOutboxEvent() {
    }

    /** 아웃박스 모드 - 미발행으로 적재하고 발행기가 커밋 후 발행한다. */
    public static RelayOutboxEvent pending(String aggregateKey, String eventType, String payload) {
        RelayOutboxEvent e = new RelayOutboxEvent();
        e.aggregateKey = aggregateKey;
        e.eventType = eventType;
        e.payload = payload;
        return e;
    }

    /** 직접 발행 모드(비교 데모용) - 적재 시점에 이미 발행된 것으로 기록한다. */
    public static RelayOutboxEvent publishedNow(String aggregateKey, String eventType, String payload) {
        RelayOutboxEvent e = pending(aggregateKey, eventType, payload);
        e.publishedAt = Instant.now();
        return e;
    }

    public void markPublished(Instant at) {
        this.publishedAt = at;
    }

    public Long getId() {
        return id;
    }

    public String getAggregateKey() {
        return aggregateKey;
    }

    public String getEventType() {
        return eventType;
    }

    public String getPayload() {
        return payload;
    }

    public Instant getPublishedAt() {
        return publishedAt;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}

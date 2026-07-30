package com.portfolio.extension.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import org.hibernate.annotations.CreationTimestamp;

/**
 * IP 접근 규칙 변경 감사 로그 - "누가/언제/무엇을" 을 남긴다. append-only(수정/삭제 없음)라
 * setter 를 두지 않고, 규칙이 삭제돼도 이력은 보존한다.
 *
 * <p>시간은 규칙과 동일하게 절대 시점(UTC {@link Instant})으로 저장한다(기기 TZ 렌더의 토대).
 * 규칙의 IP 를 스냅샷으로 함께 남겨(규칙 삭제 후에도 대상이 무엇이었는지 읽을 수 있게) 감사 가독성을
 * 확보한다. 조회는 규칙 목록과 같은 키셋(created_at desc, id desc) 방식을 재사용한다.
 */
@Entity
@Table(name = "ip_audit_log")
public class IpAuditLog {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 10)
    private IpAuditAction action;

    @Column(name = "rule_id") // 대상 규칙 id(삭제되면 규칙 행은 사라지므로 FK 는 두지 않는다)
    private Long ruleId;

    @Column(name = "ip_address", length = 45) // 변경 시점의 규칙 IP 스냅샷(가독성)
    private String ipAddress;

    @Column(nullable = false, length = 45) // 행위자(데모: 요청 원격주소, 실서비스면 인증 주체)
    private String actor;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected IpAuditLog() {
    }

    public IpAuditLog(IpAuditAction action, Long ruleId, String ipAddress, String actor) {
        this.action = action;
        this.ruleId = ruleId;
        this.ipAddress = ipAddress;
        this.actor = actor;
    }

    public Long getId() {
        return id;
    }

    public IpAuditAction getAction() {
        return action;
    }

    public Long getRuleId() {
        return ruleId;
    }

    public String getIpAddress() {
        return ipAddress;
    }

    public String getActor() {
        return actor;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}

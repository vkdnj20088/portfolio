package com.portfolio.extension.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import com.portfolio.extension.net.IpCidr;
import org.hibernate.annotations.CreationTimestamp;

/**
 * 허용 IP 접근 규칙(어드민). IP 주소와 사용 허용 기간(시작~끝)을 등록한다.
 *
 * <p>시간은 <b>절대 시점(UTC {@link Instant})</b>으로 저장한다. 화면에서는 사용자 디바이스
 * 시간대로 렌더한다(요건: 어떤 시간대의 디바이스로 접속해도 조회 시간은 항상 그 디바이스
 * 시간대로 출력). 이 앱의 다른 엔티티는 LocalDateTime 을 쓰지만, 여기서만 Instant 를 쓰는 건
 * 시간대 정합이 요건의 핵심이라 서버 TZ 에 의존하지 않는 절대 시점이 필요하기 때문이다
 * (hibernate.jdbc.time_zone=UTC 로 DATETIME 컬럼과 UTC 정합).
 */
@Entity
@Table(name = "ip_access_rule")
public class IpAccessRule {

    /** 규칙의 판정. 목록에 있으면 허용이던 모델을 명시적 판정으로 승격한 것(#G1). */
    public enum Action { ALLOW, DENY }

    public static final int DEFAULT_PRIORITY = 100;

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "ip_address", nullable = false, length = 45) // IPv6 최대 길이 대비
    private String ipAddress;

    @Column(nullable = false, length = 20) // 설명 최대 20자
    private String description;

    @Column(name = "start_at", nullable = false)
    private Instant startAt;

    @Column(name = "end_at", nullable = false)
    private Instant endAt;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    // CIDR 범위 조회용 16바이트 정규화 시작/끝 주소(#I6). 인덱스 idx_ip_range 로
    // "이 IP 를 포함하는 규칙" 을 ip_start <= X AND ip_end >= X 로 인덱스 조회한다.
    @Column(name = "ip_start", length = 16)
    private byte[] ipStart;

    @Column(name = "ip_end", length = 16)
    private byte[] ipEnd;

    /**
     * 판정 결과(#G1). ALLOW 만 있던 시절에는 규칙이 겹쳐도 결과가 같아 우선순위가 무의미했다 -
     * DENY 가 있어야 "넓은 허용 안에서 좁은 예외를 파낸다"가 표현되고 평가 순서가 실제 문제가 된다.
     * 문자열로 저장한다(ordinal 은 enum 순서를 바꾸면 기존 행의 의미가 조용히 뒤집힌다).
     */
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 8)
    private Action action = Action.ALLOW;

    /**
     * 평가 우선순위 - <b>작은 값이 먼저</b> 평가되고 첫 매치가 이긴다(iptables/ACL 관례).
     * 기본 100 은 앞뒤로 여유를 남긴 값이다: 예외 규칙은 더 작은 값(예: 10), 포괄 규칙은
     * 더 큰 값(예: 900)으로 두면 중간에 새 규칙을 끼울 자리가 남는다.
     */
    @Column(nullable = false)
    private int priority = DEFAULT_PRIORITY;

    // 낙관적 락(#Q2) - 부분수정(PUT) 시 로스트 업데이트를 차단한다. nullable 이라 레거시/시더 행과도
    // 정합하며, Hibernate 가 null 을 초기 버전으로 취급한다.
    @Version
    @Column(name = "version")
    private Long version;

    protected IpAccessRule() {
    }

    public IpAccessRule(String ipAddress, String description, Instant startAt, Instant endAt) {
        this(ipAddress, description, startAt, endAt, Action.ALLOW, DEFAULT_PRIORITY);
    }

    public IpAccessRule(String ipAddress, String description, Instant startAt, Instant endAt,
            Action action, int priority) {
        this.ipAddress = ipAddress;
        this.description = description;
        this.startAt = startAt;
        this.endAt = endAt;
        this.action = action == null ? Action.ALLOW : action;
        this.priority = priority;
        recomputeRange();
    }

    /** 부분수정(#Q2) - 가변 필드를 갱신하고 IP 가 바뀌면 정규화 범위를 다시 계산한다. */
    public void applyUpdate(String ipAddress, String description, Instant startAt, Instant endAt) {
        applyUpdate(ipAddress, description, startAt, endAt, this.action, this.priority);
    }

    /** 부분수정 - 판정/우선순위까지 포함(#G1). null/미지정은 기존 값을 유지한다. */
    public void applyUpdate(String ipAddress, String description, Instant startAt, Instant endAt,
            Action action, Integer priority) {
        this.ipAddress = ipAddress;
        this.description = description;
        this.startAt = startAt;
        this.endAt = endAt;
        if (action != null) {
            this.action = action;
        }
        if (priority != null) {
            this.priority = priority;
        }
        recomputeRange();
    }

    // ipAddress 는 서비스가 canonical 로 정규화해 넘기므로 parse 는 실패하지 않는다.
    private void recomputeRange() {
        IpCidr cidr = IpCidr.parse(ipAddress);
        this.ipStart = cidr.firstAddress16();
        this.ipEnd = cidr.lastAddress16();
    }

    public Long getId() {
        return id;
    }

    public String getIpAddress() {
        return ipAddress;
    }

    public String getDescription() {
        return description;
    }

    public Instant getStartAt() {
        return startAt;
    }

    public Instant getEndAt() {
        return endAt;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public byte[] getIpStart() {
        return ipStart;
    }

    public byte[] getIpEnd() {
        return ipEnd;
    }

    public Long getVersion() {
        return version;
    }

    public Action getAction() {
        return action;
    }

    public int getPriority() {
        return priority;
    }
}

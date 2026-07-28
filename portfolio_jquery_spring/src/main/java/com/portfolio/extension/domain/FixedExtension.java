package com.portfolio.extension.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;

/**
 * 고정 확장자. 7개가 항상 존재하며 상태(blocked)만 토글된다.
 * 존재 자체가 가변인 커스텀 확장자와 성격이 달라 테이블을 분리한다.
 */
@Entity
@Table(name = "fixed_extension")
public class FixedExtension {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true, length = 20)
    private String name;

    @Column(name = "is_blocked", nullable = false)
    private boolean blocked;

    /**
     * 낙관적 락 버전. 동시 토글 시 로스트 업데이트를 방지한다 -
     * 두 요청이 같은 버전을 읽고 각자 커밋하면 뒤늦은 커밋에서 버전 불일치로
     * {@code OptimisticLockingFailureException} 이 발생하고, 핸들러가 409 로 변환한다.
     */
    @Version
    @Column(nullable = false)
    private Long version;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    protected FixedExtension() {
    }

    public FixedExtension(String name, boolean blocked) {
        this.name = name;
        this.blocked = blocked;
    }

    public void changeBlocked(boolean blocked) {
        this.blocked = blocked;
    }

    public Long getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    public boolean isBlocked() {
        return blocked;
    }

    public Long getVersion() {
        return version;
    }
}

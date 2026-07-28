package com.portfolio.extension.repository;

import com.portfolio.extension.domain.IpAuditLog;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

/** 감사 로그 저장/조회. 키셋 조회를 위해 Specification 실행기를 함께 상속한다. */
public interface IpAuditLogRepository
        extends JpaRepository<IpAuditLog, Long>, JpaSpecificationExecutor<IpAuditLog> {
}

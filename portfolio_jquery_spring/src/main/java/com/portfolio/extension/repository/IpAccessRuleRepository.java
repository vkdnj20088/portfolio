package com.portfolio.extension.repository;

import com.portfolio.extension.domain.IpAccessRule;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * 기본 CRUD 는 {@link JpaRepository}, 목록의 동적 다중 필터(내용/기간 검색 + 키셋 커서)는
 * {@link JpaSpecificationExecutor} 의 타입 안전 Criteria 로 조립한다.
 * (이 앱은 파생 쿼리 위주지만, 선택적 필터 조합 + 키셋은 파생 메서드로 표현이 안 되어 Criteria 를 쓴다.
 *  JPQL 문자열은 여전히 쓰지 않는다.)
 */
public interface IpAccessRuleRepository
        extends JpaRepository<IpAccessRule, Long>, JpaSpecificationExecutor<IpAccessRule> {

    /**
     * 대역 포함(containment) 조회(#I6): 16바이트 정규화 주소 {@code ip} 를 범위에 포함하는 규칙.
     * {@code (ip_start, ip_end)} 인덱스를 타는 범위 스캔이다(불투명 문자열 LIKE 로는 불가능한 질의).
     * VARBINARY 는 MySQL/H2 모두 byte-wise 비교라 IPv4-mapped 정규화와 정합한다.
     */
    @Query(value = "SELECT * FROM ip_access_rule WHERE ip_start <= :ip AND ip_end >= :ip "
            + "ORDER BY created_at DESC, id DESC LIMIT :limit", nativeQuery = true)
    List<IpAccessRule> findContaining(@Param("ip") byte[] ip, @Param("limit") int limit);
}

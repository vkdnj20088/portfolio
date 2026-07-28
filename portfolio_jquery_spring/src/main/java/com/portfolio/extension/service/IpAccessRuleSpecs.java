package com.portfolio.extension.service;

import com.portfolio.extension.domain.IpAccessRule;
import jakarta.persistence.criteria.Path;
import jakarta.persistence.criteria.Predicate;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.springframework.data.jpa.domain.Specification;

/**
 * IP 규칙 목록의 동적 필터 + 키셋 커서 Predicate 를 Criteria 로 조립한다.
 * 선택 파라미터(내용/기간/커서)가 있을 때만 조건을 추가한다.
 */
final class IpAccessRuleSpecs {

    private IpAccessRuleSpecs() {
    }

    static Specification<IpAccessRule> filter(String q, Instant startFrom, Instant endTo,
            Instant cursorCreatedAt, Long cursorId) {
        return (root, query, cb) -> {
            Path<String> description = root.get("description");
            Path<Instant> startAt = root.get("startAt");
            Path<Instant> endAt = root.get("endAt");
            Path<Instant> createdAt = root.get("createdAt");
            Path<Long> id = root.get("id");

            List<Predicate> ps = new ArrayList<>();
            if (q != null && !q.isBlank()) {
                // 내용(설명) 부분검색. LIKE '%..%' 는 인덱스를 못 타 100만 행에선 풀스캔이다.
                // (트레이드오프: 접두검색 'q%' 나 MySQL FULLTEXT 로 개선 가능 - README 에 명시)
                ps.add(cb.like(description, "%" + escapeLike(q.strip()) + "%", '\\'));
            }
            if (startFrom != null) {
                ps.add(cb.greaterThanOrEqualTo(startAt, startFrom)); // 사용 시작 시간 하한
            }
            if (endTo != null) {
                ps.add(cb.lessThanOrEqualTo(endAt, endTo)); // 사용 끝 시간 상한
            }
            if (cursorCreatedAt != null && cursorId != null) {
                // 키셋: (created_at, id) < 커서 -> OFFSET 없이 다음 페이지(100만 행에서도 일정 비용)
                ps.add(cb.or(
                        cb.lessThan(createdAt, cursorCreatedAt),
                        cb.and(cb.equal(createdAt, cursorCreatedAt), cb.lessThan(id, cursorId))));
            }
            return cb.and(ps.toArray(new Predicate[0]));
        };
    }

    /** LIKE 메타문자 이스케이프(사용자 입력이 와일드카드로 오작동하지 않도록). */
    private static String escapeLike(String s) {
        return s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
    }
}

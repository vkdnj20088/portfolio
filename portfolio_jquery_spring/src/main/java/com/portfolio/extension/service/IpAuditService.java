package com.portfolio.extension.service;

import com.portfolio.extension.domain.IpAuditAction;
import com.portfolio.extension.domain.IpAuditLog;
import com.portfolio.extension.dto.IpAuditListResponse;
import com.portfolio.extension.dto.IpAuditResponse;
import com.portfolio.extension.repository.IpAuditLogRepository;
import jakarta.persistence.criteria.Predicate;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * IP 접근 규칙 변경 감사(누가/언제/무엇). append-only 기록 + 키셋 페이지네이션 조회.
 * 조회는 규칙 목록과 동일하게 등록시간 내림차순(+id 안정 정렬) 키셋을 재사용한다.
 */
@Service
public class IpAuditService {

    public static final int DEFAULT_PAGE_SIZE = 30;
    public static final int MAX_PAGE_SIZE = 100;

    private final IpAuditLogRepository repository;

    public IpAuditService(IpAuditLogRepository repository) {
        this.repository = repository;
    }

    /** 변경 이력 한 건 기록. 호출자(규칙 서비스)의 트랜잭션에 참여해 변경과 원자적으로 커밋된다. */
    @Transactional
    public void record(IpAuditAction action, Long ruleId, String ipAddress, String actor) {
        repository.save(new IpAuditLog(action, ruleId, ipAddress, actor));
    }

    @Transactional(readOnly = true)
    public IpAuditListResponse list(String cursor, int size) {
        int limit = Math.min(Math.max(size, 1), MAX_PAGE_SIZE);
        Cursor c = Cursor.decode(cursor);
        Specification<IpAuditLog> spec = keyset(c);
        PageRequest page = PageRequest.of(0, limit + 1,
                Sort.by(Sort.Order.desc("createdAt"), Sort.Order.desc("id")));

        List<IpAuditLog> rows = repository.findAll(spec, page).getContent();
        boolean hasMore = rows.size() > limit;
        List<IpAuditLog> kept = hasMore ? rows.subList(0, limit) : rows;

        String next = null;
        if (hasMore && !kept.isEmpty()) {
            IpAuditLog last = kept.get(kept.size() - 1);
            next = Cursor.encode(last.getCreatedAt(), last.getId());
        }
        return new IpAuditListResponse(
                kept.stream().map(IpAuditService::toResponse).toList(), next, hasMore);
    }

    // 키셋 조건: createdAt < cursor OR (createdAt = cursor AND id < cursorId). 커서 없으면 전체.
    private static Specification<IpAuditLog> keyset(Cursor c) {
        if (c == null) {
            return (root, q, cb) -> cb.conjunction();
        }
        return (root, q, cb) -> {
            Predicate older = cb.lessThan(root.get("createdAt"), c.createdAt());
            Predicate sameTimeSmallerId = cb.and(
                    cb.equal(root.get("createdAt"), c.createdAt()),
                    cb.lessThan(root.get("id"), c.id()));
            return cb.or(older, sameTimeSmallerId);
        };
    }

    private static IpAuditResponse toResponse(IpAuditLog a) {
        return new IpAuditResponse(a.getId(), a.getAction().name(), a.getRuleId(),
                a.getIpAddress(), a.getActor(), a.getCreatedAt());
    }

    /** 키셋 커서 = (createdAt, id). 규칙 목록과 동일한 base64(epochSecond:nano:id) 인코딩. */
    record Cursor(Instant createdAt, Long id) {
        static String encode(Instant createdAt, Long id) {
            String raw = createdAt.getEpochSecond() + ":" + createdAt.getNano() + ":" + id;
            return Base64.getUrlEncoder().withoutPadding().encodeToString(raw.getBytes(StandardCharsets.UTF_8));
        }

        static Cursor decode(String cursor) {
            if (cursor == null || cursor.isBlank()) {
                return null;
            }
            try {
                String raw = new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8);
                String[] p = raw.split(":");
                return new Cursor(Instant.ofEpochSecond(Long.parseLong(p[0]), Long.parseLong(p[1])),
                        Long.parseLong(p[2]));
            } catch (RuntimeException e) {
                return null; // 잘못된 커서는 처음부터(견고성)
            }
        }
    }
}

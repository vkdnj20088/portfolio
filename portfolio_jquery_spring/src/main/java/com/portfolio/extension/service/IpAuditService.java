package com.portfolio.extension.service;

import com.portfolio.extension.domain.IpAuditAction;
import com.portfolio.extension.domain.IpAuditLog;
import com.portfolio.extension.dto.IpAuditListResponse;
import com.portfolio.extension.dto.IpAuditResponse;
import com.portfolio.extension.repository.IpAuditLogRepository;
import jakarta.persistence.criteria.Predicate;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.function.Consumer;
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
        return list(cursor, size, new AuditFilter(null, null, null, null));
    }

    /**
     * 필터가 붙은 감사 목록(#G2). 감사 로그는 <b>쌓는 것보다 찾는 것</b>이 본질이다 - 필터 없는
     * 감사 로그는 심사에서 쓸 수 없다("작년 8월에 이 IP 를 누가 지웠나"에 답할 수 없다면 기록이
     * 있어도 없는 것과 같다).
     *
     * <p>허용하는 필터를 <b>인덱스가 타는 조합으로 제한</b>한다. 임의 조합을 열어 주면 100만 건에서
     * 풀스캔이 도는 질의가 생기고, 그 순간 감사 조회가 서비스를 느리게 만든다. 정렬·키셋은
     * (created_at, id) 그대로이고 필터는 그 위의 추가 조건이다.
     */
    @Transactional(readOnly = true)
    public IpAuditListResponse list(String cursor, int size, AuditFilter filter) {
        int limit = Math.min(Math.max(size, 1), MAX_PAGE_SIZE);
        Cursor c = Cursor.decode(cursor);
        Specification<IpAuditLog> spec = keyset(c).and(filters(filter));
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

    /**
     * 감사 조회 필터. 전부 nullable = 미지정이면 조건에서 빠진다.
     *
     * @param action    행위(CREATE/UPDATE/DELETE 등) - enum 이라 오타가 조건을 조용히 넓히지 않는다
     * @param ipAddress 대상 IP - 접두 일치(뒤에만 %). 앞에 %를 붙이면 인덱스를 못 탄다
     * @param actor     행위자 - 접두 일치
     * @param window    기간 창(하한/상한 중 하나만 지정해도 된다)
     */
    public record AuditFilter(IpAuditAction action, String ipAddress, String actor,
            TimeWindow window) {
        public AuditFilter(IpAuditAction action, String ipAddress, String actor) {
            this(action, ipAddress, actor, null);
        }

        public AuditFilter(IpAuditAction action, String ipAddress, String actor, Instant from, Instant to) {
            this(action, ipAddress, actor, (from == null && to == null) ? null : new TimeWindow(from, to));
        }
    }

    /** 감사 기간 창(둘 중 하나만 지정해도 된다). */
    public record TimeWindow(Instant from, Instant to) {
    }

    /**
     * 필터 조건 조립. 문자열 조건은 <b>접두 일치</b>만 허용한다 - `%값%`(중간 일치)은 인덱스를
     * 쓸 수 없어 100만 건에서 풀스캔이 된다. "찾을 수 있다"와 "찾아도 빠르다"는 다른 요건이다.
     */
    private static Specification<IpAuditLog> filters(AuditFilter f) {
        if (f == null) {
            return (root, q, cb) -> cb.conjunction();
        }
        return (root, q, cb) -> {
            List<Predicate> ps = new ArrayList<>(5);
            if (f.action() != null) {
                ps.add(cb.equal(root.get("action"), f.action()));
            }
            if (f.ipAddress() != null && !f.ipAddress().isBlank()) {
                ps.add(cb.like(root.get("ipAddress"), f.ipAddress().trim() + "%"));
            }
            if (f.actor() != null && !f.actor().isBlank()) {
                ps.add(cb.like(root.get("actor"), f.actor().trim() + "%"));
            }
            TimeWindow w = f.window();
            if (w != null && w.from() != null) {
                ps.add(cb.greaterThanOrEqualTo(root.get("createdAt"), w.from()));
            }
            if (w != null && w.to() != null) {
                ps.add(cb.lessThanOrEqualTo(root.get("createdAt"), w.to()));
            }
            return ps.isEmpty() ? cb.conjunction() : cb.and(ps.toArray(new Predicate[0]));
        };
    }

    /**
     * CSV 스트리밍(#G2) - 전량을 메모리에 올리지 않는다.
     *
     * <p>커서 페이지를 이어 받으며 소비자에게 한 줄씩 넘긴다. `findAll()` 로 다 받아 문자열을
     * 만들면 100만 건에서 힙이 먼저 죽고, 그건 감사 기능이 서비스를 내리는 형태다.
     * 키셋 페이지네이션이 이미 있으니 내보내기는 <b>그 위에 얹는 반복</b>일 뿐이다.
     *
     * @param maxRows 안전 상한. 무제한 내보내기는 실수 한 번이 곧 장시간 부하다.
     */
    @Transactional(readOnly = true)
    public void exportCsv(AuditFilter filter, int maxRows, Consumer<String> sink) {
        sink.accept("id,action,ruleId,ipAddress,actor,createdAt\n");
        String cursor = null;
        int written = 0;
        while (written < maxRows) {
            int want = Math.min(MAX_PAGE_SIZE, maxRows - written);
            IpAuditListResponse page = list(cursor, want, filter);
            for (IpAuditResponse row : page.items()) {
                sink.accept(csvLine(row));
                written++;
            }
            if (!page.hasMore() || page.nextCursor() == null) {
                break;
            }
            cursor = page.nextCursor();
        }
    }

    /**
     * CSV 한 줄. 모든 필드를 따옴표로 감싸고 내부 따옴표를 이중화한다(RFC 4180).
     *
     * <p>앞에 `'` 를 붙이는 이유: `=`, `+`, `-`, `@` 로 시작하는 값은 엑셀에서 <b>수식으로 해석</b>된다
     * (CSV 인젝션). 감사 로그의 actor/description 은 사용자 입력에서 오므로, 내보낸 파일을 여는
     * 순간 수식이 실행되는 경로를 막는다 - 내보내기는 신뢰 경계를 넘는 지점이다.
     */
    private static String csvLine(IpAuditResponse r) {
        return String.join(",",
                q(String.valueOf(r.id())), q(r.action()),
                q(r.ruleId() == null ? "" : String.valueOf(r.ruleId())),
                q(r.ipAddress()), q(r.actor()), q(r.createdAt().toString())) + "\n";
    }

    private static String q(String v) {
        String s = v == null ? "" : v;
        if (!s.isEmpty() && "=+-@\t\r".indexOf(s.charAt(0)) >= 0) {
            s = "'" + s;
        }
        return '"' + s.replace("\"", "\"\"") + '"';
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

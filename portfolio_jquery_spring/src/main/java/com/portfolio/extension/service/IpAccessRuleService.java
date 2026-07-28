package com.portfolio.extension.service;

import com.portfolio.extension.domain.IpAccessRule;
import com.portfolio.extension.domain.IpAuditAction;
import com.portfolio.extension.dto.IpRuleCreateRequest;
import com.portfolio.extension.dto.IpRuleUpdateRequest;
import com.portfolio.extension.dto.IpRuleListResponse;
import com.portfolio.extension.dto.IpRuleResponse;
import com.portfolio.extension.exception.IpRuleNotFoundException;
import com.portfolio.extension.net.IpCidr;
import com.portfolio.extension.observability.IpMetrics;
import com.portfolio.extension.repository.IpAccessRuleRepository;
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
 * IP 접근 규칙 어드민 CRUD + 키셋 페이지네이션 목록/검색.
 * 목록은 등록시간 내림차순, 동일 시각은 id 로 안정 정렬한다.
 */
@Service
public class IpAccessRuleService {

    public static final int DEFAULT_PAGE_SIZE = 30;
    public static final int MAX_PAGE_SIZE = 100;

    private static final String SYSTEM_ACTOR = "system";
    private static final org.slf4j.Logger log =
            org.slf4j.LoggerFactory.getLogger(IpAccessRuleService.class);

    private final IpAccessRuleRepository repository;
    private final IpAuditService auditService;
    private final IpMetrics metrics;

    public IpAccessRuleService(IpAccessRuleRepository repository, IpAuditService auditService,
            IpMetrics metrics) {
        this.repository = repository;
        this.auditService = auditService;
        this.metrics = metrics;
    }

    // no-actor 진입점도 @Transactional 이어야 저장+감사가 한 트랜잭션에 묶인다. 없으면 프록시가
    // 감싸는 건 이 바깥 메서드뿐이고, 안쪽 2-인자 오버로드는 자기호출이라 트랜잭션이 시작되지 않아
    // repository.save 와 auditService.record 가 각각 커밋된다(감사 유실 창).
    @Transactional
    public IpRuleResponse create(IpRuleCreateRequest req) {
        return create(req, SYSTEM_ACTOR);
    }

    @Transactional
    public IpRuleResponse create(IpRuleCreateRequest req, String actor) {
        // 저장 전 canonical 로 정규화한다(IPv6 축약/대소문자/CIDR host 비트 마스킹). 접수 계층에서
        // 이미 형식을 검증(@ValidIpOrCidr)했으므로 여기 parse 는 실패하지 않는다.
        String normalizedIp = IpCidr.parse(req.ipAddress()).canonical();
        IpAccessRule saved = repository.save(new IpAccessRule(
                normalizedIp, req.description().strip(), req.startAt(), req.endAt()));
        // 감사 기록은 같은 트랜잭션에 참여 - 저장이 롤백되면 이력도 남지 않는다.
        auditService.record(IpAuditAction.CREATE, saved.getId(), saved.getIpAddress(), actor);
        metrics.ruleCreated();
        // 구조화 로그(key=value) - MDC 의 cid(요청 상관 id)가 로그 패턴에 함께 실린다.
        log.info("event=ip.rule.created ruleId={} ip={} actor={}", saved.getId(), saved.getIpAddress(), actor);
        return toResponse(saved);
    }

    @Transactional
    public IpRuleResponse update(Long id, IpRuleUpdateRequest req) {
        return update(id, req, SYSTEM_ACTOR);
    }

    @Transactional
    public IpRuleResponse update(Long id, IpRuleUpdateRequest req, String actor) {
        IpAccessRule rule = repository.findById(id)
                .orElseThrow(() -> new IpRuleNotFoundException("수정할 규칙을 찾을 수 없습니다."));
        // 생성과 동일하게 canonical 정규화 후 갱신(IP 가 바뀌면 범위 컬럼도 재계산). @Version 이
        // 동시 수정 충돌을 잡으면 OptimisticLockingFailureException -> 409(GlobalExceptionHandler).
        String normalizedIp = IpCidr.parse(req.ipAddress()).canonical();
        rule.applyUpdate(normalizedIp, req.description().strip(), req.startAt(), req.endAt());
        IpAccessRule saved = repository.save(rule);
        auditService.record(IpAuditAction.UPDATE, saved.getId(), saved.getIpAddress(), actor);
        log.info("event=ip.rule.updated ruleId={} ip={} actor={}", saved.getId(), saved.getIpAddress(), actor);
        return toResponse(saved);
    }

    @Transactional
    public void delete(Long id) {
        delete(id, SYSTEM_ACTOR);
    }

    @Transactional
    public void delete(Long id, String actor) {
        // 삭제 전 IP 를 스냅샷으로 확보해 감사에 남긴다(규칙 행이 사라져도 대상이 무엇이었는지 보존).
        IpAccessRule rule = repository.findById(id)
                .orElseThrow(() -> new IpRuleNotFoundException("삭제할 규칙을 찾을 수 없습니다."));
        repository.delete(rule);
        auditService.record(IpAuditAction.DELETE, id, rule.getIpAddress(), actor);
        metrics.ruleDeleted();
        log.info("event=ip.rule.deleted ruleId={} ip={} actor={}", id, rule.getIpAddress(), actor);
    }

    @Transactional(readOnly = true)
    public IpRuleListResponse list(String q, Instant startFrom, Instant endTo, String cursor, int size) {
        int limit = Math.min(Math.max(size, 1), MAX_PAGE_SIZE);
        Cursor c = Cursor.decode(cursor);
        Specification<IpAccessRule> spec = IpAccessRuleSpecs.filter(q, startFrom, endTo,
                c == null ? null : c.createdAt(), c == null ? null : c.id());
        // size+1 을 읽어 다음 페이지 존재 여부를 판별한다(별도 count 쿼리 회피).
        PageRequest page = PageRequest.of(0, limit + 1,
                Sort.by(Sort.Order.desc("createdAt"), Sort.Order.desc("id")));

        List<IpAccessRule> rows = repository.findAll(spec, page).getContent();
        boolean hasMore = rows.size() > limit;
        List<IpAccessRule> kept = hasMore ? rows.subList(0, limit) : rows;

        String next = null;
        if (hasMore && !kept.isEmpty()) {
            IpAccessRule last = kept.get(kept.size() - 1);
            next = Cursor.encode(last.getCreatedAt(), last.getId());
        }
        return new IpRuleListResponse(
                kept.stream().map(IpAccessRuleService::toResponse).toList(), next, hasMore);
    }

    /**
     * 대역 포함 조회(#I6): 주어진 IP 를 범위에 포함하는 규칙들. IpCidr 로 16바이트 정규화 후
     * (ip_start, ip_end) 인덱스를 타는 범위 질의로 찾는다. 잘못된 IP 는 IllegalArgumentException.
     */
    @Transactional(readOnly = true)
    public List<IpRuleResponse> findContaining(String ip, int size) {
        int limit = Math.min(Math.max(size, 1), MAX_PAGE_SIZE);
        byte[] key = IpCidr.parse(ip).firstAddress16(); // 단일 IP -> start==end
        return repository.findContaining(key, limit).stream()
                .map(IpAccessRuleService::toResponse).toList();
    }

    private static IpRuleResponse toResponse(IpAccessRule r) {
        return new IpRuleResponse(r.getId(), r.getIpAddress(), r.getDescription(),
                r.getStartAt(), r.getEndAt(), r.getCreatedAt());
    }

    /**
     * 키셋 커서 = (createdAt, id). 정밀도 손실 없이 왕복하려고 epochSecond:nano:id 를 base64 로 인코딩한다
     * (커서는 항상 DB 에서 읽은 행에서 만들므로 저장값과 정확히 일치).
     */
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
                return null; // 잘못된 커서는 처음부터(무결성보다 견고성)
            }
        }
    }
}

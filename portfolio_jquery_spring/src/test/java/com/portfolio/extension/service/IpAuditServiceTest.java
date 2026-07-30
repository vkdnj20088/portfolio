package com.portfolio.extension.service;

import com.portfolio.extension.domain.IpAuditAction;
import com.portfolio.extension.dto.IpAuditListResponse;
import com.portfolio.extension.dto.IpRuleResponse;
import com.portfolio.extension.repository.IpAuditLogRepository;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * IP 감사 로그 서비스 테스트(H2). 변경 훅으로 기록되는지, 키셋 페이지네이션 조회가
 * 등록시간 내림차순으로 중복/누락 없이 도는지 고정한다.
 */
@SpringBootTest
class IpAuditServiceTest {

    private static final Instant S = Instant.parse("2024-06-01T00:00:00Z");
    private static final Instant E = Instant.parse("2024-06-02T00:00:00Z");

    @Autowired
    private IpAuditService auditService;
    @Autowired
    private IpAccessRuleService ruleService;
    @Autowired
    private IpAuditLogRepository auditRepository;

    @BeforeEach
    void clean() {
        auditRepository.deleteAll();
    }

    @Test
    void record_writesRow() {
        auditService.record(IpAuditAction.CREATE, 10L, "10.0.0.1", "127.0.0.1");
        IpAuditListResponse res = auditService.list(null, 10);
        assertThat(res.items()).hasSize(1);
        assertThat(res.items().get(0).action()).isEqualTo("CREATE");
        assertThat(res.items().get(0).ipAddress()).isEqualTo("10.0.0.1");
        assertThat(res.items().get(0).actor()).isEqualTo("127.0.0.1");
    }

    @Test
    void ruleChange_producesAuditTrail_createThenDelete() {
        // 규칙 생성/삭제가 감사 훅으로 이력을 남긴다(같은 트랜잭션).
        IpRuleResponse created = ruleService.create(new com.portfolio.extension.dto.IpRuleCreateRequest(
                "10.0.0.9", "감사 대상", S, E, null, null), "관리자IP");
        ruleService.delete(created.id(), "관리자IP");

        IpAuditListResponse res = auditService.list(null, 10);
        assertThat(res.items()).hasSize(2);
        // 최신순: DELETE 가 먼저
        assertThat(res.items().get(0).action()).isEqualTo("DELETE");
        assertThat(res.items().get(1).action()).isEqualTo("CREATE");
        assertThat(res.items()).allSatisfy(a -> {
            assertThat(a.ipAddress()).isEqualTo("10.0.0.9"); // 삭제 후에도 IP 스냅샷 보존
            assertThat(a.actor()).isEqualTo("관리자IP");
        });
    }

    @Test
    void list_keysetPagination_ordersCreatedDesc_withoutOverlap() {
        for (int i = 0; i < 5; i++) {
            auditService.record(IpAuditAction.CREATE, (long) i, "10.0.0." + i, "actor");
        }
        IpAuditListResponse p1 = auditService.list(null, 2);
        assertThat(p1.items()).hasSize(2);
        assertThat(p1.hasMore()).isTrue();

        IpAuditListResponse p2 = auditService.list(p1.nextCursor(), 2);
        IpAuditListResponse p3 = auditService.list(p2.nextCursor(), 2);
        assertThat(p3.items()).hasSize(1);
        assertThat(p3.hasMore()).isFalse();

        List<Long> ids = new ArrayList<>();
        p1.items().forEach(a -> ids.add(a.id()));
        p2.items().forEach(a -> ids.add(a.id()));
        p3.items().forEach(a -> ids.add(a.id()));
        assertThat(ids).hasSize(5).doesNotHaveDuplicates()
                .isSortedAccordingTo(Comparator.reverseOrder()); // 등록시간 desc == id desc
    }
}

package com.portfolio.extension.service;

import com.portfolio.extension.domain.IpAuditAction;
import com.portfolio.extension.dto.IpAuditListResponse;
import com.portfolio.extension.service.IpAuditService.AuditFilter;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.TestPropertySource;
import org.springframework.transaction.annotation.Transactional;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 감사 로그 필터 + CSV 스트리밍(#G2).
 *
 * <p>검증의 핵심은 두 가지다. (1) 필터가 실제로 좁히는가, (2) 내보내기가 <b>페이지를 이어받아</b>
 * 상한까지 흘리는가. 후자를 재려고 페이지 크기보다 많은 행을 심는다 - 한 페이지에 들어가는
 * 데이터로는 "이어받기"가 검증되지 않는다.
 */
@SpringBootTest
@TestPropertySource(properties = "app.ip-seed.count=0") // 시더가 감사 로그를 만들지 않지만 기동을 가볍게
@Transactional
class IpAuditExportTest {

    @Autowired
    private IpAuditService auditService;

    private static final Instant BASE = Instant.parse("2026-07-01T00:00:00Z");

    @BeforeEach
    void seed() {
        // 120건 - MAX_PAGE_SIZE(100)보다 많아 CSV 내보내기가 두 페이지를 이어받아야 한다.
        for (int i = 0; i < 120; i++) {
            IpAuditAction action = (i % 3 == 0) ? IpAuditAction.CREATE
                    : (i % 3 == 1) ? IpAuditAction.UPDATE : IpAuditAction.DELETE;
            auditService.record(action, (long) i, "203.0.113." + (i % 256), "actor" + (i % 4));
        }
    }

    @Test
    @DisplayName("행위 필터가 결과를 좁힌다")
    void filterByAction() {
        IpAuditListResponse all = auditService.list(null, 100, new AuditFilter(null, null, null));
        IpAuditListResponse creates = auditService.list(null, 100,
                new AuditFilter(IpAuditAction.CREATE, null, null));
        assertThat(all.items()).isNotEmpty();
        assertThat(creates.items()).isNotEmpty().allSatisfy(r -> assertThat(r.action()).isEqualTo("CREATE"));
        assertThat(creates.items().size()).isLessThan(all.items().size());
    }

    @Test
    @DisplayName("행위자 필터는 접두 일치다 - 인덱스를 쓸 수 있는 형태만 허용한다")
    void filterByActorPrefix() {
        IpAuditListResponse r = auditService.list(null, 100, new AuditFilter(null, null, "actor1"));
        assertThat(r.items()).isNotEmpty().allSatisfy(x -> assertThat(x.actor()).startsWith("actor1"));
        // 중간 일치는 지원하지 않는다: 접두가 아니면 안 잡힌다(이것이 의도된 계약이다).
        assertThat(auditService.list(null, 100, new AuditFilter(null, null, "ctor1")).items()).isEmpty();
    }

    @Test
    @DisplayName("기간 필터 - 미래 하한이면 아무것도 안 나온다")
    void filterByWindow() {
        AuditFilter future = new AuditFilter(null, null, null,
                Instant.now().plusSeconds(3600), null);
        assertThat(auditService.list(null, 100, future).items()).isEmpty();

        AuditFilter past = new AuditFilter(null, null, null, BASE, null);
        assertThat(auditService.list(null, 100, past).items()).isNotEmpty();
    }

    @Test
    @DisplayName("CSV 내보내기는 페이지를 이어받아 전량을 흘린다(헤더 1줄 + 데이터)")
    void csvStreamsAcrossPages() {
        List<String> chunks = new ArrayList<>();
        auditService.exportCsv(new AuditFilter(null, null, null), 1000, chunks::add);

        assertThat(chunks.getFirst()).isEqualTo("id,action,ruleId,ipAddress,actor,createdAt\n");
        // 120건이 MAX_PAGE_SIZE(100)를 넘으므로 두 페이지 이상을 이어받았다는 뜻이다.
        assertThat(chunks).hasSize(121);
        assertThat(chunks.get(1)).startsWith("\"").endsWith("\n");
    }

    @Test
    @DisplayName("maxRows 상한을 넘기지 않는다 - 무제한 내보내기는 실수 한 번이 부하다")
    void csvRespectsMaxRows() {
        List<String> chunks = new ArrayList<>();
        auditService.exportCsv(new AuditFilter(null, null, null), 10, chunks::add);
        assertThat(chunks).hasSize(11); // 헤더 + 10행
    }

    @Test
    @DisplayName("CSV 인젝션 방어 - 수식 시작 문자는 접두 인용으로 무력화한다")
    void csvInjectionNeutralised() {
        auditService.record(IpAuditAction.CREATE, 999L, "203.0.113.1", "=cmd|'/c calc'!A1");
        List<String> chunks = new ArrayList<>();
        auditService.exportCsv(new AuditFilter(null, null, "="), 5, chunks::add);

        // 필터가 접두 '=' 로 그 행을 찾고, 출력에서는 앞에 ' 가 붙어 엑셀이 수식으로 읽지 않는다.
        String row = chunks.stream().filter(c -> c.contains("cmd")).findFirst().orElseThrow();
        assertThat(row).contains("\"'=cmd");
        assertThat(row).doesNotContain(",=cmd");
    }
}

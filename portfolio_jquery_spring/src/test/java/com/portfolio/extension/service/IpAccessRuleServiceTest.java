package com.portfolio.extension.service;

import com.portfolio.extension.domain.IpAccessRule;
import com.portfolio.extension.dto.IpRuleCreateRequest;
import com.portfolio.extension.dto.IpRuleListResponse;
import com.portfolio.extension.dto.IpRuleResponse;
import com.portfolio.extension.dto.IpRuleUpdateRequest;
import com.portfolio.extension.exception.IpRuleNotFoundException;
import com.portfolio.extension.repository.IpAccessRuleRepository;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * IP 접근 규칙 서비스 테스트(H2). 시간대 정합(UTC 왕복), 키셋 페이지네이션(중복/누락 없음),
 * 내용/기간 검색, 삭제/미존재를 고정한다.
 */
@SpringBootTest
class IpAccessRuleServiceTest {

    private static final Instant S = Instant.parse("2024-06-01T00:00:00Z");
    private static final Instant E = Instant.parse("2024-06-02T00:00:00Z");

    @Autowired
    private IpAccessRuleService service;
    @Autowired
    private IpAccessRuleRepository repository;

    @BeforeEach
    void clean() {
        repository.deleteAll();
    }

    private IpRuleResponse create(String ip, String desc, Instant s, Instant e) {
        return service.create(new IpRuleCreateRequest(ip, desc, s, e));
    }

    @Test
    void create_preservesUtcInstant_onRoundTrip() {
        Instant s = Instant.parse("2024-06-01T00:00:00Z"); // KST 09:00 에 해당하는 절대 시점
        Instant e = Instant.parse("2024-06-05T09:00:00Z");
        IpRuleResponse created = create("1.1.1.1", "관리자 접근 IP", s, e);

        assertThat(created.startAt()).isEqualTo(s);
        assertThat(created.endAt()).isEqualTo(e);

        // 재조회해도 절대 시점이 동일(서버 TZ 무관 - 디바이스 TZ 렌더의 토대)
        IpRuleResponse read = service.list(null, null, null, null, 10).items().get(0);
        assertThat(read.startAt()).isEqualTo(s);
        assertThat(read.endAt()).isEqualTo(e);
    }

    @Test
    void list_keysetPagination_ordersCreatedDesc_withoutOverlap() {
        for (int i = 0; i < 5; i++) {
            create("10.0.0." + i, "규칙 " + i, S, E);
        }
        IpRuleListResponse p1 = service.list(null, null, null, null, 2);
        assertThat(p1.items()).hasSize(2);
        assertThat(p1.hasMore()).isTrue();

        IpRuleListResponse p2 = service.list(null, null, null, p1.nextCursor(), 2);
        IpRuleListResponse p3 = service.list(null, null, null, p2.nextCursor(), 2);
        assertThat(p3.items()).hasSize(1);
        assertThat(p3.hasMore()).isFalse();

        List<Long> ids = new ArrayList<>();
        p1.items().forEach(r -> ids.add(r.id()));
        p2.items().forEach(r -> ids.add(r.id()));
        p3.items().forEach(r -> ids.add(r.id()));
        assertThat(ids).hasSize(5)
                .doesNotHaveDuplicates()
                .isSortedAccordingTo(Comparator.reverseOrder()); // 등록시간 desc == id desc
    }

    @Test
    void list_contentSearch_matchesDescriptionSubstring() {
        create("1.1.1.1", "사내망 대역", S, E);
        create("2.2.2.2", "협력사 API 서버", S, E);

        IpRuleListResponse res = service.list("사내", null, null, null, 10);
        assertThat(res.items()).hasSize(1);
        assertThat(res.items().get(0).description()).contains("사내");
    }

    @Test
    void list_periodSearch_filtersByStartFromAndEndTo() {
        create("1.1.1.1", "6월", Instant.parse("2024-06-01T00:00:00Z"), Instant.parse("2024-06-02T00:00:00Z"));
        create("2.2.2.2", "8월", Instant.parse("2024-08-01T00:00:00Z"), Instant.parse("2024-08-10T00:00:00Z"));

        IpRuleListResponse res = service.list(null, Instant.parse("2024-07-01T00:00:00Z"), null, null, 10);
        assertThat(res.items()).hasSize(1);
        assertThat(res.items().get(0).ipAddress()).isEqualTo("2.2.2.2");
    }

    @Test
    void update_changesFields_recomputesRange_andBumpsVersion() {
        IpRuleResponse created = create("10.0.0.0/24", "원본", S, E);
        IpRuleResponse updated = service.update(created.id(),
                new IpRuleUpdateRequest("192.168.1.0/24", "수정됨", S, E));

        assertThat(updated.ipAddress()).isEqualTo("192.168.1.0/24");
        assertThat(updated.description()).isEqualTo("수정됨");
        // 범위 재계산 -> 새 대역에서 잡히고 옛 대역에선 안 잡힌다(#Q2 + #I6 정합)
        assertThat(service.findContaining("192.168.1.5", 10))
                .extracting(IpRuleResponse::id).contains(created.id());
        assertThat(service.findContaining("10.0.0.5", 10)).isEmpty();
        // 낙관적 락 버전 증가
        IpAccessRule row = repository.findById(created.id()).orElseThrow();
        assertThat(row.getVersion()).isNotNull().isGreaterThan(0L);
    }

    @Test
    void update_missing_throws() {
        assertThatThrownBy(() -> service.update(999L,
                new IpRuleUpdateRequest("1.1.1.1", "x", S, E)))
                .isInstanceOf(IpRuleNotFoundException.class);
    }

    @Test
    void delete_removesRule_andMissingThrows() {
        IpRuleResponse r = create("1.1.1.1", "x", S, E);
        service.delete(r.id());
        assertThat(repository.count()).isZero();

        assertThatThrownBy(() -> service.delete(999L)).isInstanceOf(IpRuleNotFoundException.class);
    }
}

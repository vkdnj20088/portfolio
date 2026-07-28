package com.portfolio.extension.service;

import com.portfolio.extension.domain.IpAuditAction;
import com.portfolio.extension.dto.IpRuleCreateRequest;
import com.portfolio.extension.repository.IpAccessRuleRepository;
import java.time.Instant;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doThrow;

/**
 * no-actor 진입점(create/update/delete 단일 인자)의 저장+감사 원자성 회귀 가드.
 * 감사 기록이 실패하면 규칙 저장도 롤백되어야 한다("감사 없는 규칙"이 남지 않는다).
 * 오버로드에 @Transactional 이 없으면 저장이 별도 트랜잭션으로 먼저 커밋되어 규칙이 남는다 - 그걸 잡는다.
 */
@SpringBootTest
class IpAccessRuleAtomicityTest {

    @Autowired
    private IpAccessRuleService service;
    @Autowired
    private IpAccessRuleRepository repository;
    @MockitoBean
    private IpAuditService auditService;

    @BeforeEach
    void clean() {
        repository.deleteAll();
    }

    @Test
    void create_rollsBackRuleWhenAuditFails() {
        doThrow(new RuntimeException("감사 기록 실패"))
                .when(auditService).record(any(IpAuditAction.class), any(), anyString(), anyString());

        assertThatThrownBy(() -> service.create(
                new IpRuleCreateRequest("1.1.1.1", "관리자 IP", Instant.parse("2024-06-01T00:00:00Z"),
                        Instant.parse("2024-06-02T00:00:00Z"))))
                .isInstanceOf(RuntimeException.class);

        // 감사가 던졌으므로 규칙 저장도 함께 롤백 - 테이블은 비어 있어야 한다.
        assertThat(repository.count()).isZero();
    }
}

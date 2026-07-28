package com.portfolio.extension.service;

import com.portfolio.extension.domain.FixedExtension;
import com.portfolio.extension.dto.FixedExtensionResponse;
import com.portfolio.extension.exception.ExtensionNotFoundException;
import com.portfolio.extension.repository.FixedExtensionRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 고정 확장자 서비스 테스트 - 토글/정규화/미존재, 그리고 @Version 낙관적 락 버전 증가.
 * (테스트 간 간섭을 피하려 서로 다른 고정 확장자를 사용한다.)
 */
@SpringBootTest
class FixedExtensionServiceTest {

    @Autowired
    private FixedExtensionService service;
    @Autowired
    private FixedExtensionRepository repository;

    @Test
    void toggleUpdatesBlockedState() {
        FixedExtensionResponse res = service.toggle("bat", true);

        assertThat(res.blocked()).isTrue();
        assertThat(repository.findByName("bat").orElseThrow().isBlocked()).isTrue();
    }

    @Test
    void toggleNormalizesDottedUppercaseName() {
        // 커스텀과 동일한 정규화 정책: ".CMD" -> "cmd"
        service.toggle(".CMD", true);

        assertThat(repository.findByName("cmd").orElseThrow().isBlocked()).isTrue();
    }

    @Test
    void toggleUnknownNameThrows() {
        assertThatThrownBy(() -> service.toggle("nope", true))
                .isInstanceOf(ExtensionNotFoundException.class);
    }

    @Test
    void toggleIncrementsOptimisticLockVersionOnChange() {
        FixedExtension before = repository.findByName("com").orElseThrow();
        Long versionBefore = before.getVersion();
        boolean current = before.isBlocked();

        service.toggle("com", !current); // 상태를 반드시 바꿔 dirty update 유발 -> version++

        FixedExtension after = repository.findByName("com").orElseThrow();
        assertThat(after.getVersion()).isGreaterThan(versionBefore);
        assertThat(after.isBlocked()).isEqualTo(!current);
    }
}

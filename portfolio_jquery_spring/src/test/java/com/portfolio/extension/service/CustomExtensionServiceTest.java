package com.portfolio.extension.service;

import com.portfolio.extension.domain.CustomExtension;
import com.portfolio.extension.dto.CustomCreatedResponse;
import com.portfolio.extension.exception.DuplicateExtensionException;
import com.portfolio.extension.exception.ExtensionLimitExceededException;
import com.portfolio.extension.exception.ExtensionNotFoundException;
import com.portfolio.extension.exception.InvalidExtensionException;
import com.portfolio.extension.repository.CustomExtensionRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import java.util.List;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@SpringBootTest
class CustomExtensionServiceTest {

    @Autowired
    private CustomExtensionService service;
    @Autowired
    private CustomExtensionRepository customRepository;

    @BeforeEach
    void clean() {
        customRepository.deleteAll();
    }

    @Test
    void addNormalizesInputBeforeSaving() {
        CustomCreatedResponse res = service.add("  .SH  ");
        assertThat(res.name()).isEqualTo("sh");
        assertThat(res.count()).isEqualTo(1);
        assertThat(customRepository.existsByName("sh")).isTrue();
    }

    @Test
    void addRejectsDuplicate() {
        service.add("sh");
        assertThatThrownBy(() -> service.add(".SH"))
                .isInstanceOf(DuplicateExtensionException.class);
    }

    @Test
    void addRejectsNameThatCollidesWithFixedExtension() {
        // "exe" 는 고정 확장자 -> 커스텀으로 추가 불가(교차 중복)
        assertThatThrownBy(() -> service.add("exe"))
                .isInstanceOf(DuplicateExtensionException.class);
    }

    @ParameterizedTest
    @ValueSource(strings = {"a b", "sh!", "한글", "ex.e", "", ".", "  "})
    void addRejectsInvalidFormat(String raw) {
        assertThatThrownBy(() -> service.add(raw))
                .isInstanceOf(InvalidExtensionException.class);
    }

    @Test
    void addRejectsTooLong() {
        String twentyOne = "a".repeat(21);
        assertThatThrownBy(() -> service.add(twentyOne))
                .isInstanceOf(InvalidExtensionException.class);
    }

    @Test
    void addEnforcesMaxCount() {
        List<CustomExtension> seed = IntStream.range(0, CustomExtensionService.MAX_CUSTOM)
                .mapToObj(i -> new CustomExtension("ext" + i))
                .toList();
        customRepository.saveAll(seed);

        assertThatThrownBy(() -> service.add("overflow"))
                .isInstanceOf(ExtensionLimitExceededException.class);
        assertThat(customRepository.count()).isEqualTo(CustomExtensionService.MAX_CUSTOM);
    }

    @Test
    void deleteRemovesExisting() {
        CustomCreatedResponse res = service.add("sh");
        service.delete(res.id());
        assertThat(customRepository.existsById(res.id())).isFalse();
    }

    @Test
    void deleteMissingThrows() {
        assertThatThrownBy(() -> service.delete(999_999L))
                .isInstanceOf(ExtensionNotFoundException.class);
    }
}

package com.portfolio.extension.util;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import static org.assertj.core.api.Assertions.assertThat;

class ExtensionNormalizerTest {

    private final ExtensionNormalizer normalizer = new ExtensionNormalizer();

    @ParameterizedTest
    @CsvSource({
            "EXE, exe",
            ".exe, exe",
            "..EXE.., exe",
            ".JS, js",
            "Exe., exe"
    })
    void normalizesToCanonicalForm(String raw, String expected) {
        assertThat(normalizer.normalize(raw)).isEqualTo(expected);
    }

    @Test
    void trimsSurroundingWhitespace() {
        assertThat(normalizer.normalize("   exe   ")).isEqualTo("exe");
    }

    @Test
    void keepsInternalDot() {
        // 내부 점은 보존 -> 화이트리스트에서 걸러진다(차단 단위 = 최종 확장자 토큰)
        assertThat(normalizer.normalize("tar.gz")).isEqualTo("tar.gz");
    }

    @Test
    void nullStaysNull() {
        assertThat(normalizer.normalize(null)).isNull();
    }
}

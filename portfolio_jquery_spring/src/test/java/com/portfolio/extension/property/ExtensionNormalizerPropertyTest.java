package com.portfolio.extension.property;

import com.portfolio.extension.util.ExtensionNormalizer;
import java.util.Locale;
import net.jqwik.api.ForAll;
import net.jqwik.api.Property;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 확장자 정규화 불변식(#Q3) - 예제 테스트 너머, jqwik 이 수백 개의 임의 문자열로 성질을 검증한다.
 * "특정 입력이 맞나"가 아니라 "어떤 입력에도 성립해야 하는 규칙"을 못박는다.
 */
class ExtensionNormalizerPropertyTest {

    private final ExtensionNormalizer normalizer = new ExtensionNormalizer();

    @Property
    void idempotent(@ForAll String raw) {
        // 정규화는 멱등이어야 한다 - 저장/비교 전 한 번 통과시키면 다시 통과시켜도 불변.
        String once = normalizer.normalize(raw);
        String twice = normalizer.normalize(once);
        assertThat(twice).isEqualTo(once);
    }

    @Property
    void outputHasNoSurroundingDotsOrWhitespace_andIsLowercase(@ForAll String raw) {
        String out = normalizer.normalize(raw);
        if (out == null || out.isEmpty()) {
            return; // null/빈 결과는 규칙 대상 아님
        }
        assertThat(out).doesNotStartWith(".").doesNotEndWith(".");
        // normalize 의 계약은 String.trim()(ASCII 공백) - 유니코드 공백까지 지우진 않으므로 trim 기준으로 검증
        assertThat(out).isEqualTo(out.trim());
        assertThat(out).isEqualTo(out.toLowerCase(Locale.ROOT)); // 소문자(ROOT)
    }

    @Property
    void neverThrows_forAnyInput(@ForAll String raw) {
        // 임의 입력(제어문자/유니코드 포함)에도 예외 없이 결과를 낸다.
        normalizer.normalize(raw);
    }

    @Property
    void nullMapsToNull(@ForAll("nullable") String raw) {
        if (raw == null) {
            assertThat(normalizer.normalize(null)).isNull();
        }
    }

    @net.jqwik.api.Provide
    net.jqwik.api.Arbitrary<String> nullable() {
        return net.jqwik.api.Arbitraries.of("exe", "EXE", ".tar.gz.", "  x  ", "").injectNull(0.3);
    }
}

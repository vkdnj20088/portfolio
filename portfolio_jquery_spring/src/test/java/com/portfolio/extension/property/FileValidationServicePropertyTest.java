package com.portfolio.extension.property;

import com.portfolio.extension.dto.FileValidationResponse;
import com.portfolio.extension.observability.FileValidationMetrics;
import com.portfolio.extension.repository.CustomExtensionRepository;
import com.portfolio.extension.service.BlockedExtensionProvider;
import com.portfolio.extension.service.FileValidationService;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.util.Set;
import net.jqwik.api.ForAll;
import net.jqwik.api.Property;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 파일 검증 견고성 불변식(#Q3) - 바이트 파싱(매직넘버/컨테이너 introspection)이 가치인 코드에
 * jqwik 으로 임의 바이트/파일명을 쏟아부어 <b>어떤 입력에도 크래시하지 않고 판정을 낸다</b>를 못박는다.
 * (13개 예제 테스트가 못 잡는 엣지 - 우연히 PK/ar 매직으로 시작하는 쓰레기 바이트 등.)
 */
class FileValidationServicePropertyTest {

    private final FileValidationService service;

    {
        BlockedExtensionProvider provider = mock(BlockedExtensionProvider.class);
        when(provider.current()).thenReturn(Set.of("exe", "bat", "sh"));
        CustomExtensionRepository repo = mock(CustomExtensionRepository.class);
        FileValidationMetrics metrics = new FileValidationMetrics(new SimpleMeterRegistry(), repo);
        service = new FileValidationService(provider, metrics);
    }

    @Property(tries = 300)
    void neverThrows_onArbitraryBytesAndFilename(@ForAll byte[] content, @ForAll String filename) {
        FileValidationResponse res = service.validate(filename, content);
        assertThat(res).isNotNull();
    }

    @Property
    void emptyOrTinyContent_doesNotCrash(@ForAll String filename) {
        assertThat(service.validate(filename, new byte[0])).isNotNull();
        assertThat(service.validate(filename, new byte[]{0x50, 0x4B})).isNotNull(); // 잘린 ZIP 매직
        assertThat(service.validate(filename, new byte[]{0x21, 0x3C})).isNotNull(); // 잘린 ar 매직
    }
}

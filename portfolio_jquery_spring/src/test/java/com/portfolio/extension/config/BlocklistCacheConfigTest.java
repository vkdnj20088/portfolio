package com.portfolio.extension.config;

import com.portfolio.extension.service.BlockedExtensionProvider;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;
import org.springframework.cache.caffeine.CaffeineCacheManager;
import org.springframework.cache.interceptor.SimpleKey;
import org.springframework.test.context.TestPropertySource;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.awaitility.Awaitility.await;

/**
 * #6 캐시 코히런스 - 차단 목록 캐시가 유계 TTL 을 갖는지 실증한다.
 *
 * <p>세 가지를 굳힌다: (1) TTL 을 걸 수 있는 Caffeine 매니저가 배선됐다, (2) 이벤트 기반 무효화가
 * 그 위에서도 동작한다(단일 인스턴스 즉시 코히런스), (3) write 후 TTL 이 지나면 항목이 만료된다
 * (다중 인스턴스 스테일이 '영구'가 아니라 '상한'을 가짐). TTL 은 테스트에서 1초로 좁혀 만료를 관측한다.
 */
@SpringBootTest
@TestPropertySource(properties = "app.cache.blocklist-ttl-seconds=1")
class BlocklistCacheConfigTest {

    @Autowired
    private CacheManager cacheManager;
    @Autowired
    private BlockedExtensionProvider provider;

    @Test
    void managerSupportsTtl() {
        assertThat(cacheManager).isInstanceOf(CaffeineCacheManager.class);
    }

    @Test
    void currentIsCachedThenEvictedOnInvalidate() {
        Cache cache = cacheManager.getCache("blockedExtensions");
        assertThat(cache).isNotNull();
        cache.clear();

        provider.current();
        assertThat(cache.get(SimpleKey.EMPTY)).isNotNull(); // 캐시에 적재됨

        provider.invalidate(); // 코히런스 트리거(AFTER_COMMIT 이벤트가 부르는 경로)
        assertThat(cache.get(SimpleKey.EMPTY)).isNull();     // 즉시 무효화됨(단일 인스턴스)
    }

    @Test
    void currentReturnsImmutableSet() {
        // 반환 집합은 캐시에 공유 저장된다 - 호출자가 변조하면 이후 모든 파일 검증이
        // 오염된 차단 목록을 보게 되므로, 불변임을 계약으로 고정한다.
        assertThatThrownBy(() -> provider.current().add("hack"))
                .isInstanceOf(UnsupportedOperationException.class);
    }

    @Test
    void cacheEntryExpiresAfterTtl() {
        Cache cache = cacheManager.getCache("blockedExtensions");
        assertThat(cache).isNotNull();
        cache.clear();

        provider.current();
        assertThat(cache.get(SimpleKey.EMPTY)).isNotNull();

        // TTL(1s) 경과 후 만료 - 다중 인스턴스에서 스테일 창이 무한대가 아니라 상한을 가짐을 실증한다.
        await().atMost(Duration.ofSeconds(5))
                .untilAsserted(() -> assertThat(cache.get(SimpleKey.EMPTY)).isNull());
    }
}

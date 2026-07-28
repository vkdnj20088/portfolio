package com.portfolio.extension.config;

import com.github.benmanes.caffeine.cache.Caffeine;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.cache.CacheManager;
import org.springframework.cache.annotation.EnableCaching;
import org.springframework.cache.caffeine.CaffeineCacheManager;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Duration;

/**
 * 캐싱 활성화 + 차단 목록 캐시의 유계 TTL 설정.
 *
 * <p>이 설정을 메인 클래스에서 분리해 {@code @WebMvcTest} 웹 슬라이스는 로드하지 않게 한다(슬라이스는
 * 웹 컴포넌트만 스캔). 캐시는 웹 계층 관심사가 아니므로 컨트롤러 계약 테스트가 CacheManager 없이
 * 가볍게 돈다. (Spring Boot 4 부터 캐시 오토컨피그가 별도 모듈이라 이 분리가 특히 유효하다.)
 *
 * <p><b>#6 캐시 코히런스</b>: {@code blockedExtensions} 는 in-JVM 캐시라, 다중 인스턴스로 확장하면
 * 인스턴스 A 의 변경이 A 의 캐시만 무효화하고 B 의 캐시는 계속 옛 목록을 반환한다 - 보안 블록리스트에서
 * 이 스테일은 "차단이 걸려야 하는데 안 걸리는" 창이다. 단일 인스턴스에서는 이벤트 기반 즉시 무효화
 * ({@code BlocklistCacheEvictor}, AFTER_COMMIT)로 창이 없지만, 다른 인스턴스의 캐시까지 즉시 비울
 * 방법은 공유 캐시/브로드캐스트가 있어야 한다. 여기서는 인프라 없이 <b>Caffeine 의 write 후 만료
 * (TTL)</b>로 그 창을 무한대에서 상한(기본 60초)으로 바꾼다. 무-스테일이 필요하면 redis 프로파일에서
 * Redis 백드 공유 캐시로 CacheManager 를 교체한다(락과 같은 방식으로 확장).
 */
@Configuration
@EnableCaching
public class CachingConfig {

    @Bean
    public CacheManager cacheManager(
            @Value("${app.cache.blocklist-ttl-seconds:60}") long ttlSeconds) {
        CaffeineCacheManager manager = new CaffeineCacheManager();
        manager.setCaffeine(Caffeine.newBuilder()
                .expireAfterWrite(Duration.ofSeconds(ttlSeconds)) // 다중 인스턴스 스테일 상한
                .maximumSize(64)); // 캐시 키는 사실상 1개(무인자 current). 여유값.
        return manager;
    }
}

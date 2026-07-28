package com.portfolio.extension.config;

import java.util.concurrent.TimeUnit;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.CacheControl;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * 정적 자산 캐시 정책(Lighthouse cache-TTL / uses-long-cache-ttl).
 *
 * <p>webpack 콘텐츠 해시 번들(/js, /css)은 내용이 바뀌면 파일명(해시)이 바뀌므로 1년 immutable
 * 캐시가 안전하다 - 재방문 시 재다운로드가 사라지고, 배포로 내용이 바뀌면 새 파일명이라 캐시가
 * 자연히 무효화된다. 반면 index.html/ip.html 은 그 해시 번들을 가리키는 진입점이라 장기 캐시하면
 * 배포 후에도 옛 번들을 가리키는 stale 이 된다 - 그래서 여기서 다루지 않고 기본 핸들러가 캐시 없이
 * 매번 최신 HTML 을 서빙하게 둔다(HTML 은 작아 비용도 미미).
 *
 * <p>CSP 와 무관(캐시 헤더만 부여). SecurityHeadersFilter 의 응답 헤더 설정과 충돌하지 않는다.
 */
@Configuration
public class StaticResourceConfig implements WebMvcConfigurer {

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        CacheControl immutable = CacheControl.maxAge(365, TimeUnit.DAYS).cachePublic().immutable();
        registry.addResourceHandler("/js/**")
                .addResourceLocations("classpath:/static/js/")
                .setCacheControl(immutable);
        registry.addResourceHandler("/css/**")
                .addResourceLocations("classpath:/static/css/")
                .setCacheControl(immutable);
    }
}

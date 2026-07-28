package com.portfolio.extension.config;

import jakarta.servlet.FilterChain;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

/**
 * SecurityHeadersFilter 단위 테스트 - 슬라이스/컨텍스트 없이 필터 로직만 결정론적으로 검증.
 */
class SecurityHeadersFilterTest {

    private final SecurityHeadersFilter filter = new SecurityHeadersFilter();

    @Test
    void addsCspAndHardeningHeaders() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/extensions/custom");
        MockHttpServletResponse response = new MockHttpServletResponse();
        FilterChain chain = mock(FilterChain.class);

        filter.doFilter(request, response, chain);

        assertThat(response.getHeader("Content-Security-Policy"))
                .contains("default-src 'self'")
                .contains("object-src 'none'")
                .contains("frame-ancestors 'none'");
        assertThat(response.getHeader("X-Content-Type-Options")).isEqualTo("nosniff");
        assertThat(response.getHeader("X-Frame-Options")).isEqualTo("DENY");
        assertThat(response.getHeader("Referrer-Policy")).isEqualTo("no-referrer");
        assertThat(response.getHeader("Cross-Origin-Opener-Policy")).isEqualTo("same-origin");
        assertThat(response.getHeader("Cross-Origin-Resource-Policy")).isEqualTo("same-origin");
        assertThat(response.getHeader("Permissions-Policy"))
                .contains("camera=()")
                .contains("microphone=()")
                .contains("geolocation=()");
        verify(chain).doFilter(request, response);
    }

    @Test
    void doesNotSendHeadersThatAreInvalidOrHarmfulHere() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/");
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request, response, mock(FilterChain.class));

        // HSTS: 브라우저는 IP 리터럴 호스트에 적용하지 않는다 -> 넣어도 무효라 넣지 않는다.
        assertThat(response.getHeader("Strict-Transport-Security")).isNull();
        // X-XSS-Protection: 폐기된 헤더(과거 취약점 유발 이력). CSP 가 대체한다.
        assertThat(response.getHeader("X-XSS-Protection")).isNull();
        // COEP: cross-origin isolation 이 필요 없는 앱이라 이득 없이 깨질 위험만 있다.
        assertThat(response.getHeader("Cross-Origin-Embedder-Policy")).isNull();
        // FLoC 제안은 폐기됨 -> interest-cohort 를 넣지 않는다.
        assertThat(response.getHeader("Permissions-Policy")).doesNotContain("interest-cohort");
    }

    @Test
    void skipsH2Console() throws Exception {
        // H2 콘솔은 iframe/인라인 의존 -> 필터 제외(shouldNotFilter). 헤더가 부여되지 않아야 한다.
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/h2-console/login.do");
        request.setRequestURI("/h2-console/login.do");
        MockHttpServletResponse response = new MockHttpServletResponse();
        FilterChain chain = mock(FilterChain.class);

        filter.doFilter(request, response, chain);

        assertThat(response.getHeader("Content-Security-Policy")).isNull();
        verify(chain).doFilter(request, response);
    }
}

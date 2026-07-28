package com.portfolio.extension.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * 응답 보안 헤더를 부여하는 필터 - 파일명->확장자 XSS 대응의 다층 방어(defense-in-depth).
 *
 * <p>핵심은 <b>CSP</b>다. 이 앱은 인라인 스크립트/스타일이 전혀 없으므로
 * {@code 'unsafe-inline'} 없이 순수 {@code default-src 'self'} 로 제한할 수 있고,
 * 이는 반사/저장형 XSS 를 원천적으로 무력화한다. 여기에
 * {@code object-src 'none'}(플러그인, 실행객체 임베드 차단),
 * {@code frame-ancestors 'none'}(클릭재킹), {@code base-uri 'self'},
 * {@code form-action 'self'} 를 더해 공격 표면을 좁힌다.
 *
 * <p>{@code /h2-console} 은 자체 iframe, 인라인 리소스에 의존하므로 제외한다(개발 전용,
 * 운영 prod 프로파일에서는 콘솔 자체가 비활성).
 *
 * <p><b>의도적으로 넣지 않은 헤더</b>(일반 가이드가 흔히 권하지만 이 서비스에는 맞지 않는 것):
 * <ul>
 *   <li>{@code Strict-Transport-Security} - 브라우저는 <b>IP 리터럴 호스트에 HSTS 를 적용하지 않는다</b>.
 *       {@code includeSubDomains}/{@code preload} 도 도메인 개념이 있어야 성립한다. 넣어도 무효라 넣지 않는다.</li>
 *   <li>{@code Cross-Origin-Embedder-Policy: require-corp} - 이 앱은 cross-origin isolation 이 필요한
 *       기능(SharedArrayBuffer, 정밀 타이머 등)을 쓰지 않는다. 얻는 것 없이, 훗날 외부 리소스를 추가하면
 *       조용히 깨지는 비용만 남는다.</li>
 *   <li>{@code X-XSS-Protection} - 폐기된 헤더다. 과거 일부 브라우저에서 오히려 취약점을 만들었고
 *       현재는 무시된다. CSP 가 이를 대체한다.</li>
 * </ul>
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class SecurityHeadersFilter extends OncePerRequestFilter {

    private static final String CSP =
            "default-src 'self'; "
                    + "object-src 'none'; "
                    + "frame-ancestors 'none'; "
                    + "base-uri 'self'; "
                    + "form-action 'self'";

    /**
     * 이 앱이 쓰지 않는 브라우저 기능을 전면 차단한다. 지금은 우리 코드가 호출하지 않으니 실익이 작지만,
     * XSS 나 서드파티 스크립트가 유입되는 상황을 가정한 심층 방어다.
     * (FLoC 용 {@code interest-cohort} 는 제안 자체가 폐기되어 넣지 않는다.)
     */
    private static final String PERMISSIONS_POLICY =
            "accelerometer=(), autoplay=(), camera=(), display-capture=(), encrypted-media=(), "
                    + "fullscreen=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), "
                    + "midi=(), payment=(), usb=(), xr-spatial-tracking=()";

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        response.setHeader("Content-Security-Policy", CSP);
        response.setHeader("X-Content-Type-Options", "nosniff");   // MIME 스니핑 차단
        response.setHeader("X-Frame-Options", "DENY");             // 구형 브라우저 클릭재킹 방어
        response.setHeader("Referrer-Policy", "no-referrer");
        response.setHeader("Permissions-Policy", PERMISSIONS_POLICY);
        // 이 문서를 연 창과 다른 오리진의 창을 분리한다 - window.opener 를 통한 참조/탭내빙 차단.
        response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
        // 다른 오리진이 우리 리소스를 임베드/핫링크하지 못하게 한다.
        response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
        filterChain.doFilter(request, response);
    }

    /** 개발용 H2 콘솔/springdoc Swagger UI 는 iframe/인라인 자원에 의존하므로 CSP 적용에서 제외한다. */
    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String uri = request.getRequestURI();
        return uri.startsWith("/h2-console")
                || uri.startsWith("/swagger-ui")
                || uri.startsWith("/v3/api-docs");
    }
}

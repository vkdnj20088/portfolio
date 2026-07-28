package com.portfolio.extension.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.UUID;
import org.slf4j.MDC;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * 요청별 상관 ID(correlation id)를 MDC 에 심어 구조화 로그가 한 요청의 흐름을 이어 볼 수 있게 한다.
 * 들어온 {@code X-Request-Id} 를 존중하되(분산 추적 연계), 없으면 UUID 를 만들고 응답 헤더로 돌려준다.
 *
 * <p>보안: 외부에서 온 헤더는 로그에 그대로 실리므로 <b>화이트리스트 문자 + 길이 제한</b>으로 정제해
 * 로그 인젝션(개행 등)을 막는다. 가장 앞 필터로 두어 이후 모든 로그에 id 가 실리게 한다.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class CorrelationIdFilter extends OncePerRequestFilter {

    public static final String HEADER = "X-Request-Id";
    public static final String MDC_KEY = "cid";
    private static final int MAX_LEN = 64;

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
            FilterChain chain) throws ServletException, IOException {
        String cid = sanitize(request.getHeader(HEADER));
        if (cid == null) {
            cid = UUID.randomUUID().toString();
        }
        MDC.put(MDC_KEY, cid);
        response.setHeader(HEADER, cid);
        try {
            chain.doFilter(request, response);
        } finally {
            MDC.remove(MDC_KEY); // 스레드 재사용(풀) 시 이전 요청 id 가 새어나가지 않게 반드시 정리
        }
    }

    // [A-Za-z0-9-] 만 허용, 1..64 자. 위반하면 null(호출측이 새 id 생성).
    private static String sanitize(String raw) {
        if (raw == null || raw.isBlank() || raw.length() > MAX_LEN) {
            return null;
        }
        for (int i = 0; i < raw.length(); i++) {
            char c = raw.charAt(i);
            boolean ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
                    || (c >= '0' && c <= '9') || c == '-';
            if (!ok) {
                return null;
            }
        }
        return raw;
    }
}

package com.portfolio.extension.config;

import jakarta.servlet.FilterChain;
import org.junit.jupiter.api.Test;
import org.slf4j.MDC;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 상관 ID 필터 - MDC 주입/응답헤더 반영/스레드 정리, 유입 헤더 정제(로그 인젝션 방지)를 고정한다.
 */
class CorrelationIdFilterTest {

    private final CorrelationIdFilter filter = new CorrelationIdFilter();

    @Test
    void generatesId_whenNoHeader_andClearsMdcAfter() throws Exception {
        MockHttpServletRequest req = new MockHttpServletRequest();
        MockHttpServletResponse res = new MockHttpServletResponse();
        String[] cidDuring = new String[1];
        FilterChain chain = (rq, rs) -> cidDuring[0] = MDC.get(CorrelationIdFilter.MDC_KEY);

        filter.doFilter(req, res, chain);

        assertThat(cidDuring[0]).isNotBlank(); // 요청 처리 중 MDC 에 존재
        assertThat(res.getHeader(CorrelationIdFilter.HEADER)).isEqualTo(cidDuring[0]); // 응답으로 회신
        assertThat(MDC.get(CorrelationIdFilter.MDC_KEY)).isNull(); // 처리 후 반드시 정리
    }

    @Test
    void honorsValidIncomingHeader() throws Exception {
        MockHttpServletRequest req = new MockHttpServletRequest();
        req.addHeader(CorrelationIdFilter.HEADER, "abc-123-DEF");
        MockHttpServletResponse res = new MockHttpServletResponse();
        String[] cidDuring = new String[1];

        filter.doFilter(req, res, (rq, rs) -> cidDuring[0] = MDC.get(CorrelationIdFilter.MDC_KEY));

        assertThat(cidDuring[0]).isEqualTo("abc-123-DEF");
        assertThat(res.getHeader(CorrelationIdFilter.HEADER)).isEqualTo("abc-123-DEF");
    }

    @Test
    void rejectsMaliciousHeader_generatesFresh() throws Exception {
        MockHttpServletRequest req = new MockHttpServletRequest();
        req.addHeader(CorrelationIdFilter.HEADER, "bad\r\nInjected: x"); // 개행 인젝션 시도
        MockHttpServletResponse res = new MockHttpServletResponse();
        String[] cidDuring = new String[1];

        filter.doFilter(req, res, (rq, rs) -> cidDuring[0] = MDC.get(CorrelationIdFilter.MDC_KEY));

        assertThat(cidDuring[0]).doesNotContain("\n").doesNotContain("Injected");
        assertThat(cidDuring[0]).matches("[A-Za-z0-9-]+"); // 정제되어 안전한 UUID 로 대체
    }
}

package com.portfolio.extension.controller;

import com.portfolio.extension.dto.IpAuditListResponse;
import com.portfolio.extension.dto.IpRuleListResponse;
import com.portfolio.extension.dto.IpRuleResponse;
import com.portfolio.extension.exception.IpRuleNotFoundException;
import com.portfolio.extension.observability.IpMetrics;
import com.portfolio.extension.service.IpAccessRuleService;
import com.portfolio.extension.service.IpAuditService;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * IP 접근 규칙 컨트롤러 계약 테스트. 서비스는 목으로 대체하고 HTTP 계층 계약만 고정한다:
 * 상태코드 <-> Bean Validation(설명 20자, 시작<=끝 @AssertTrue)/도메인 예외 매핑, 응답 형태.
 */
@WebMvcTest(IpAccessRuleController.class)
class IpAccessRuleControllerTest {

    @Autowired
    private MockMvc mvc;

    @MockitoBean
    private IpAccessRuleService service;
    @MockitoBean
    private IpAuditService auditService;
    @MockitoBean
    private IpMetrics metrics;

    private static final String VALID = "{\"ipAddress\":\"1.2.3.4\",\"description\":\"관리자\","
            + "\"startAt\":\"2024-06-01T00:00:00Z\",\"endAt\":\"2024-06-02T00:00:00Z\"}";

    @Test
    void create_valid_returns201() throws Exception {
        given(service.create(any(), any())).willReturn(new IpRuleResponse(1L, "1.2.3.4", "관리자",
                Instant.parse("2024-06-01T00:00:00Z"), Instant.parse("2024-06-02T00:00:00Z"),
                Instant.parse("2026-01-01T00:00:00Z")));

        mvc.perform(post("/api/ip-rules").contentType(MediaType.APPLICATION_JSON).content(VALID))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id").value(1))
                .andExpect(jsonPath("$.ipAddress").value("1.2.3.4"))
                .andExpect(jsonPath("$.startAt").value("2024-06-01T00:00:00Z"));
    }

    @Test
    void create_startAfterEnd_returns400_withoutCallingService() throws Exception {
        // @AssertTrue(isValidPeriod) 가 서비스 도달 전에 차단(예시 데이터가 뒤집힌 케이스 방어)
        String reversed = "{\"ipAddress\":\"1.2.3.4\",\"description\":\"뒤집힘\","
                + "\"startAt\":\"2024-06-10T00:00:00Z\",\"endAt\":\"2024-06-01T00:00:00Z\"}";

        mvc.perform(post("/api/ip-rules").contentType(MediaType.APPLICATION_JSON).content(reversed))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID"));

        verify(service, never()).create(any(), any());
    }

    @Test
    void create_descriptionTooLong_returns400_withoutCallingService() throws Exception {
        String desc21 = "가".repeat(21);
        String body = "{\"ipAddress\":\"1.2.3.4\",\"description\":\"" + desc21 + "\","
                + "\"startAt\":\"2024-06-01T00:00:00Z\",\"endAt\":\"2024-06-02T00:00:00Z\"}";

        mvc.perform(post("/api/ip-rules").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isBadRequest());

        verify(service, never()).create(any(), any());
    }

    @Test
    void update_valid_returns200() throws Exception {
        given(service.update(eq(1L), any(), any())).willReturn(new IpRuleResponse(1L, "1.2.3.4", "수정됨",
                Instant.parse("2024-06-01T00:00:00Z"), Instant.parse("2024-06-02T00:00:00Z"),
                Instant.parse("2026-01-01T00:00:00Z")));

        mvc.perform(put("/api/ip-rules/1").contentType(MediaType.APPLICATION_JSON).content(VALID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.description").value("수정됨"));
    }

    @Test
    void update_missing_returns404() throws Exception {
        given(service.update(eq(999L), any(), any())).willThrow(new IpRuleNotFoundException("없음"));

        mvc.perform(put("/api/ip-rules/999").contentType(MediaType.APPLICATION_JSON).content(VALID))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND"));
    }

    @Test
    void delete_existing_returns204() throws Exception {
        doNothing().when(service).delete(eq(1L), any());

        mvc.perform(delete("/api/ip-rules/1")).andExpect(status().isNoContent());
        verify(service).delete(eq(1L), any());
    }

    @Test
    void delete_missing_returns404() throws Exception {
        doThrow(new IpRuleNotFoundException("없음")).when(service).delete(eq(999L), any());

        mvc.perform(delete("/api/ip-rules/999"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND"));
    }

    @Test
    void whoami_returnsRemoteAddr() throws Exception {
        mvc.perform(get("/api/ip-rules/whoami"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ipAddress").value("127.0.0.1")); // MockMvc 기본 remote addr
    }

    @Test
    void list_returns200() throws Exception {
        given(service.list(any(), any(), any(), any(), anyInt()))
                .willReturn(new IpRuleListResponse(List.of(), null, false));

        mvc.perform(get("/api/ip-rules"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.hasMore").value(false));
    }

    @Test
    void create_malformedIp_returns400_withoutCallingService() throws Exception {
        // @ValidIpOrCidr 가 접수 단계에서 잘못된 IP 를 차단(서비스 도달 전 400)
        String body = "{\"ipAddress\":\"999.1.1.1\",\"description\":\"악성\","
                + "\"startAt\":\"2024-06-01T00:00:00Z\",\"endAt\":\"2024-06-02T00:00:00Z\"}";

        mvc.perform(post("/api/ip-rules").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID"));

        verify(service, never()).create(any(), any());
    }

    @Test
    void match_cidrContainsTarget_returns200_true() throws Exception {
        mvc.perform(get("/api/ip-rules/match").param("rule", "10.0.0.0/24").param("target", "10.0.0.7"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.matches").value(true))
                .andExpect(jsonPath("$.normalizedRule").value("10.0.0.0/24"))
                .andExpect(jsonPath("$.family").value("IPV4"));
    }

    @Test
    void match_outOfRange_returns200_false() throws Exception {
        mvc.perform(get("/api/ip-rules/match").param("rule", "10.0.0.0/24").param("target", "10.0.1.7"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.matches").value(false));
    }

    @Test
    void match_malformedInput_returns400() throws Exception {
        mvc.perform(get("/api/ip-rules/match").param("rule", "not-an-ip").param("target", "10.0.0.1"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID"));
    }

    @Test
    void audit_returns200_keysetShape() throws Exception {
        given(auditService.list(any(), anyInt()))
                .willReturn(new IpAuditListResponse(List.of(), null, false));

        mvc.perform(get("/api/ip-rules/audit"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.hasMore").value(false));
    }
}

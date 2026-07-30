package com.portfolio.extension.controller;

import com.portfolio.extension.dto.IpAuditListResponse;
import com.portfolio.extension.dto.IpRuleListResponse;
import com.portfolio.extension.dto.IpRuleResponse;
import com.portfolio.extension.exception.IpRuleNotFoundException;
import com.portfolio.extension.observability.IpMetrics;
import com.portfolio.extension.service.IpAccessRuleService;
import com.portfolio.extension.service.IpPolicyEvaluator;
import com.portfolio.extension.service.IpAuditService;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
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
import static org.mockito.Mockito.doAnswer;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * IP 접근 규칙 컨트롤러 계약 테스트. 서비스는 목으로 대체하고 HTTP 계층 계약만 고정한다:
 * 상태코드 <-> Bean Validation(설명 20자, 시작<=끝 @AssertTrue)/도메인 예외 매핑, 응답 형태.
 */
@WebMvcTest(IpAccessRuleController.class)
// 평가기는 의존성 없는 순수 계산기다. 목으로 두면 판정 규칙(#G1)이 검증되지 않으므로 실물을 넣는다 -
// 슬라이스 테스트에서도 "계산은 실물, I/O 는 목"이 기본이다.
@Import(IpPolicyEvaluator.class)
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
                Instant.parse("2026-01-01T00:00:00Z"), "ALLOW", 100));

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
                Instant.parse("2026-01-01T00:00:00Z"), "ALLOW", 100));

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
        // 필터 오버로드(#G2)를 스텁한다. 컨트롤러가 3-인자 쪽을 부르므로 2-인자 스텁은 매치하지 않는다.
        given(auditService.list(any(), anyInt(), any()))
                .willReturn(new IpAuditListResponse(List.of(), null, false));

        mvc.perform(get("/api/ip-rules/audit"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.hasMore").value(false));
    }

    @Test
    @DisplayName("정책 평가(#G1) - 매치 규칙이 없으면 기본 정책(거부)과 근거를 돌려준다")
    void evaluate_noRules_returnsDenyWithReason() throws Exception {
        given(service.findContainingForEvaluation(any())).willReturn(List.of());

        mvc.perform(get("/api/ip-rules/evaluate").param("target", "203.0.113.9"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.decision").value("DENY"))
                .andExpect(jsonPath("$.matchedRule").doesNotExist())
                .andExpect(jsonPath("$.evaluatedRules").isArray())
                .andExpect(jsonPath("$.reason").value(org.hamcrest.Matchers.containsString("기본 정책")));
    }

    @Test
    @DisplayName("정책 평가 - 잘못된 IP 는 400(problem+json)")
    void evaluate_malformed_returns400() throws Exception {
        mvc.perform(get("/api/ip-rules/evaluate").param("target", "999.1.1.1"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID"))
                .andExpect(jsonPath("$.title").exists())
                .andExpect(jsonPath("$.detail").exists());
    }

    @Test
    @DisplayName("감사 CSV(#G2) - 스트리밍 응답에 헤더와 다운로드 지시가 실린다")
    void auditCsv_streamsWithDownloadHeaders() throws Exception {
        // 서비스가 sink 로 두 줄을 흘리는 것을 흉내낸다(컨트롤러가 그걸 그대로 흘리는지 본다).
        doAnswer(inv -> {
            java.util.function.Consumer<String> sink = inv.getArgument(2);
            sink.accept("id,action,ruleId,ipAddress,actor,createdAt\n");
            sink.accept("\"1\",\"CREATE\",\"7\",\"1.2.3.4\",\"admin\",\"2026-07-30T00:00:00Z\"\n");
            return null;
        }).when(auditService).exportCsv(any(), anyInt(), any());

        mvc.perform(get("/api/ip-rules/audit.csv"))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Disposition", "attachment; filename=\"ip-audit.csv\""))
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(content().string(org.hamcrest.Matchers.containsString("id,action,ruleId")))
                .andExpect(content().string(org.hamcrest.Matchers.containsString("CREATE")));
    }
}

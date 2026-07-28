package com.portfolio.extension.controller;

import com.portfolio.extension.dto.FixedExtensionResponse;
import com.portfolio.extension.exception.ExtensionNotFoundException;
import com.portfolio.extension.service.FixedExtensionService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 고정 확장자 컨트롤러 계약 테스트 - 목록(200)/토글(200)/미존재 토글(404).
 */
@WebMvcTest(FixedExtensionController.class)
class FixedExtensionControllerTest {

    @Autowired
    private MockMvc mvc;

    @MockitoBean
    private FixedExtensionService service;

    @Test
    void list_returns200() throws Exception {
        given(service.list()).willReturn(List.of(
                new FixedExtensionResponse("exe", false),
                new FixedExtensionResponse("bat", true)));

        mvc.perform(get("/api/extensions/fixed"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].name").value("exe"))
                .andExpect(jsonPath("$[0].blocked").value(false))
                .andExpect(jsonPath("$[1].blocked").value(true));
    }

    @Test
    void toggle_returns200WithNewState() throws Exception {
        given(service.toggle(eq("exe"), eq(true)))
                .willReturn(new FixedExtensionResponse("exe", true));

        mvc.perform(patch("/api/extensions/fixed/exe")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"blocked\":true}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("exe"))
                .andExpect(jsonPath("$.blocked").value(true));
    }

    @Test
    void toggle_unknownName_returns404() throws Exception {
        given(service.toggle(anyString(), anyBoolean()))
                .willThrow(new ExtensionNotFoundException("고정 확장자를 찾을 수 없습니다"));

        mvc.perform(patch("/api/extensions/fixed/nope")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"blocked\":true}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND"));
    }

    @Test
    void toggle_missingBlockedField_returns400_withoutCallingService() throws Exception {
        // fail-safe: 본문에 blocked 가 없으면(원시형이었다면 조용히 false 로 "해제"됐을 요청) 400 으로 거절한다.
        mvc.perform(patch("/api/extensions/fixed/exe")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID"));

        verify(service, never()).toggle(anyString(), anyBoolean());
    }
}

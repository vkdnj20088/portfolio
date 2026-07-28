package com.portfolio.extension.controller;

import com.portfolio.extension.dto.CustomCreatedResponse;
import com.portfolio.extension.dto.CustomItemResponse;
import com.portfolio.extension.dto.CustomListResponse;
import com.portfolio.extension.exception.DuplicateExtensionException;
import com.portfolio.extension.exception.ExtensionLimitExceededException;
import com.portfolio.extension.exception.ExtensionNotFoundException;
import com.portfolio.extension.exception.InvalidExtensionException;
import com.portfolio.extension.service.CustomExtensionService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 커스텀 확장자 컨트롤러 계약(contract) 테스트.
 *
 * <p>서비스는 {@code @MockBean} 으로 대체하고 <b>HTTP 계층의 계약</b>만 고정한다:
 * 상태코드(200/201/204/400/409/422/404) <-> 도메인 예외/Bean Validation 매핑, 응답 바디 형태.
 * 이 회귀 테스트가 이번 하드닝(Bean Validation, 예외->상태 매핑)을 잠근다.
 */
@WebMvcTest(CustomExtensionController.class)
class CustomExtensionControllerTest {

    @Autowired
    private MockMvc mvc;

    @MockitoBean
    private CustomExtensionService service;

    @Test
    void list_returns200WithCountAndLimit() throws Exception {
        given(service.list()).willReturn(
                new CustomListResponse(List.of(new CustomItemResponse(1L, "sh")), 1, 200));

        mvc.perform(get("/api/extensions/custom"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.count").value(1))
                .andExpect(jsonPath("$.limit").value(200))
                .andExpect(jsonPath("$.extensions[0].name").value("sh"));
    }

    @Test
    void add_valid_returns201() throws Exception {
        given(service.add("sh")).willReturn(new CustomCreatedResponse(1L, "sh", 1));

        mvc.perform(post("/api/extensions/custom")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"sh\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id").value(1))
                .andExpect(jsonPath("$.name").value("sh"))
                .andExpect(jsonPath("$.count").value(1));
    }

    @Test
    void add_duplicate_returns409() throws Exception {
        given(service.add(anyString())).willThrow(new DuplicateExtensionException("이미 등록됨"));

        mvc.perform(post("/api/extensions/custom")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"sh\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("DUPLICATE"));
    }

    @Test
    void add_overLimit_returns422() throws Exception {
        given(service.add(anyString())).willThrow(new ExtensionLimitExceededException("상한 초과"));

        mvc.perform(post("/api/extensions/custom")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"sh\"}"))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("LIMIT_EXCEEDED"));
    }

    @Test
    void add_invalidFormatFromService_returns400() throws Exception {
        // 형식(화이트리스트) 검증은 서비스 책임 -> InvalidExtensionException
        given(service.add(anyString())).willThrow(new InvalidExtensionException("허용 문자 아님"));

        mvc.perform(post("/api/extensions/custom")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"a!\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID"));
    }

    @Test
    void add_blankName_returns400_withoutCallingService() throws Exception {
        // Bean Validation(@NotBlank) 이 서비스 도달 전에 차단
        mvc.perform(post("/api/extensions/custom")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"   \"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID"));

        verify(service, never()).add(anyString());
    }

    @Test
    void add_tooLongName_returns400_withoutCallingService() throws Exception {
        // Bean Validation(@Size(max=20))
        String twentyOne = "a".repeat(21);

        mvc.perform(post("/api/extensions/custom")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"" + twentyOne + "\"}"))
                .andExpect(status().isBadRequest());

        verify(service, never()).add(anyString());
    }

    @Test
    void delete_existing_returns204() throws Exception {
        doNothing().when(service).delete(1L);

        mvc.perform(delete("/api/extensions/custom/1"))
                .andExpect(status().isNoContent());

        verify(service).delete(1L);
    }

    @Test
    void delete_missing_returns404() throws Exception {
        doThrow(new ExtensionNotFoundException("없음")).when(service).delete(999L);

        mvc.perform(delete("/api/extensions/custom/999"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND"));
    }

    @Test
    void delete_nonNumericId_returns400() throws Exception {
        // 타입 불일치(String -> Long) -> MethodArgumentTypeMismatch -> 400
        mvc.perform(delete("/api/extensions/custom/abc"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID"));
    }

    @Test
    void response_carriesSecurityHeaders() throws Exception {
        // 필터(SecurityHeadersFilter)가 @WebMvcTest 슬라이스에도 적용됨을 확인
        given(service.list()).willReturn(new CustomListResponse(List.of(), 0, 200));

        mvc.perform(get("/api/extensions/custom"))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Security-Policy",
                        org.hamcrest.Matchers.containsString("default-src 'self'")))
                .andExpect(header().string("X-Content-Type-Options", "nosniff"));
    }
}

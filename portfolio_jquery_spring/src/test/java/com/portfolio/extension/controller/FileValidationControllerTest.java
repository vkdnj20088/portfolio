package com.portfolio.extension.controller;

import com.portfolio.extension.dto.FileValidationResponse;
import com.portfolio.extension.service.FileValidationService;
import com.portfolio.extension.service.StorageService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 파일 검증 + 저장 컨트롤러 계약 테스트. 멀티파트 바인딩, 응답 직렬화, 저장 연동(통과 시만 저장),
 * 그리고 파트 누락 시의 에러 계약을 고정한다. 서비스/저장소는 @MockitoBean 으로 대체한다.
 */
@WebMvcTest(FileValidationController.class)
class FileValidationControllerTest {

    @Autowired
    private MockMvc mvc;

    @MockitoBean
    private FileValidationService service;
    @MockitoBean
    private StorageService storageService;

    @Test
    void validate_allowedFile_storesAndReturnsStoredId() throws Exception {
        given(service.validate(eq("photo.jpg"), any())).willReturn(FileValidationResponse.allow("jpg"));
        given(storageService.store(any())).willReturn(new StorageService.StoredFile("stored-abc", 4));

        MockMultipartFile file = new MockMultipartFile(
                "file", "photo.jpg", "image/jpeg",
                new byte[] {(byte) 0xFF, (byte) 0xD8, (byte) 0xFF, (byte) 0xE0}); // JPEG

        mvc.perform(multipart("/api/files/validate").file(file))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.allowed").value(true))
                .andExpect(jsonPath("$.extension").value("jpg"))
                .andExpect(jsonPath("$.storedId").value("stored-abc"));

        verify(storageService).store(any()); // 통과한 파일은 격리 저장된다
    }

    @Test
    void validate_disguisedExecutable_blocksAndDoesNotStore() throws Exception {
        given(service.validate(eq("virus.jpg"), any())).willReturn(
                FileValidationResponse.block("파일 내용이 실행파일 시그니처(PE/EXE (MZ))입니다.", "jpg", "PE/EXE (MZ)"));

        MockMultipartFile file = new MockMultipartFile(
                "file", "virus.jpg", "image/jpeg",
                new byte[] {(byte) 0x4D, (byte) 0x5A, 0x00, 0x00}); // "MZ"

        mvc.perform(multipart("/api/files/validate").file(file))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.allowed").value(false))
                .andExpect(jsonPath("$.detectedSignature").value("PE/EXE (MZ)"));

        verify(storageService, never()).store(any()); // 차단된 파일은 저장하지 않는다
    }

    @Test
    void validate_missingFilePart_returns400() throws Exception {
        // 'file' 파트 없이 요청 -> GlobalExceptionHandler 가 {code,message} 400 으로 통일한다.
        mvc.perform(multipart("/api/files/validate"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID"));
    }
}

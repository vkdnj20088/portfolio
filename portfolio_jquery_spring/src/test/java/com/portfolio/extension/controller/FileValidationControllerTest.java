package com.portfolio.extension.controller;

import com.portfolio.extension.dto.FileValidationResponse;
import com.portfolio.extension.exception.ValidationCapacityException;
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
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
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

    /**
     * 용량 초과(벌크헤드/타임아웃)는 503 + <b>{@code Retry-After} 헤더</b> + 본문 확장 필드로 나간다(#C2).
     *
     * <p>헤더를 함께 확인하는 이유: 본문 필드는 우리 프론트만 읽지만 {@code Retry-After} 는 RFC 9110
     * 표준이라 우리 코드를 모르는 클라이언트도 해석한다. 둘 중 하나만 있으면 "재시도 가능 시점"을
     * 아는 클라이언트가 한쪽으로 제한된다.
     */
    @Test
    void validate_capacityExceeded_returns503WithRetryAfter() throws Exception {
        given(service.validate(eq("big.zip"), any()))
                .willThrow(new ValidationCapacityException("동시에 처리 중인 검증이 많습니다.", 2));

        MockMultipartFile file = new MockMultipartFile(
                "file", "big.zip", "application/zip",
                new byte[] {0x50, 0x4B, 0x03, 0x04}); // "PK"

        mvc.perform(multipart("/api/files/validate").file(file))
                .andExpect(status().isServiceUnavailable())
                .andExpect(header().string("Retry-After", "2"))
                .andExpect(jsonPath("$.code").value("CAPACITY"))
                .andExpect(jsonPath("$.retryAfterSeconds").value(2));

        verify(storageService, never()).store(any()); // 검증을 못 했으면 저장하지 않는다
    }
}

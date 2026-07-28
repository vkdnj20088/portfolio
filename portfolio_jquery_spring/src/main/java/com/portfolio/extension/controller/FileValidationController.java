package com.portfolio.extension.controller;

import com.portfolio.extension.dto.FileValidationResponse;
import com.portfolio.extension.service.FileValidationService;
import com.portfolio.extension.service.StorageService;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;

/**
 * 파일 첨부 검증 + 안전 격리 저장 엔드포인트(#8).
 * 전체 내용으로 검증하고(컨테이너 포맷 판별에 필요), 통과한 파일만 웹루트 밖에 UUID 이름으로 격리 저장한다.
 */
@RestController
@RequestMapping("/api/files")
public class FileValidationController {

    private final FileValidationService fileValidationService;
    private final StorageService storageService;

    public FileValidationController(FileValidationService fileValidationService,
                                    StorageService storageService) {
        this.fileValidationService = fileValidationService;
        this.storageService = storageService;
    }

    @PostMapping(value = "/validate", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public FileValidationResponse validate(@RequestParam("file") MultipartFile file) throws IOException {
        // 전체 내용을 검증에 넘긴다 - 앞 8바이트만으론 JAR/APK(공통 PK 프리픽스)/DEB(공통 ar)를
        // 평범한 zip/ar 과 구분할 수 없어 컨테이너 내용 검사가 도달하지 못한다. 상한은 멀티파트 5MB.
        byte[] content = file.getBytes();

        FileValidationResponse validation = fileValidationService.validate(file.getOriginalFilename(), content);
        if (!validation.allowed()) {
            return validation; // 차단된 파일은 저장하지 않는다
        }
        // 통과한 파일만 안전 격리 저장(웹루트 밖 / UUID / 실행권한 제거) 후 storedId 를 붙여 반환한다.
        return validation.withStoredId(storageService.store(content).id());
    }
}

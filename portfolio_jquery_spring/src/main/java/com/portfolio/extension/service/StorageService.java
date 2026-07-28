package com.portfolio.extension.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.UUID;

/**
 * 검증을 통과한 파일을 안전하게 격리 저장하는 파이프라인(#8).
 *
 * <p>확장자 차단 + 내용 검증(FileValidationService)이 "받을지 말지"를 정한다면, 여기는 받은 파일을
 * "어떻게 두는지"의 방어다. 실행/유출로 이어지는 흔한 실수를 구조적으로 막는다:
 * <ul>
 *   <li>웹 루트 밖(설정 가능, 기본 임시 디렉토리)에 둔다 - URL 로 직접 실행/다운로드되지 않는다.</li>
 *   <li>UUID 로 rename - 원본 파일명 기반 경로 조작/덮어쓰기/추측을 막는다.</li>
 *   <li>소유자 rw------- 권한 - 실행 비트를 제거해 저장 파일이 실행되지 않는다(POSIX).</li>
 *   <li>용량 상한 - 멀티파트 상한과 별개의 최후 방어선.</li>
 * </ul>
 */
@Service
public class StorageService {

    private static final Logger log = LoggerFactory.getLogger(StorageService.class);

    /** 저장 결과 핸들. 원본 경로 대신 id 만 노출해 파일 위치를 감춘다. */
    public record StoredFile(String id, long size) {
    }

    private final Path quarantineDir;
    private final long maxBytes;

    public StorageService(
            @Value("${app.storage.quarantine-dir:}") String configuredDir,
            @Value("${app.storage.max-file-size-bytes:5242880}") long maxBytes) {
        this.maxBytes = maxBytes;
        this.quarantineDir = configuredDir.isBlank()
                ? Path.of(System.getProperty("java.io.tmpdir"), "quarantine")
                : Path.of(configuredDir);
        try {
            Files.createDirectories(quarantineDir);
        } catch (IOException e) {
            throw new UncheckedIOException("격리 디렉토리를 만들 수 없습니다: " + quarantineDir, e);
        }
    }

    /**
     * 파일을 격리 디렉토리에 UUID 이름으로 저장하고 실행 권한을 제거한다. 원본 파일명은 쓰지 않는다.
     */
    public StoredFile store(byte[] content) {
        if (content.length > maxBytes) {
            throw new IllegalArgumentException(
                    "저장 가능한 용량을 초과했습니다: " + content.length + " > " + maxBytes);
        }
        String id = UUID.randomUUID().toString();
        Path target = quarantineDir.resolve(id); // 순수 UUID 라 경로 이탈(traversal) 불가
        try {
            Files.write(target, content, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE);
        } catch (IOException e) {
            throw new UncheckedIOException("파일을 저장하지 못했습니다.", e);
        }
        restrictPermissions(target);
        log.info("file quarantined: id={}, size={}", id, content.length);
        return new StoredFile(id, content.length);
    }

    /** 소유자 읽기/쓰기만 남기고 실행 비트를 제거한다. 비-POSIX(Windows)면 조용히 넘어간다. */
    private void restrictPermissions(Path path) {
        try {
            Files.setPosixFilePermissions(path, PosixFilePermissions.fromString("rw-------"));
        } catch (UnsupportedOperationException | IOException e) {
            // 핵심 방어(웹루트 밖 격리 + UUID rename)는 유지된다. 권한 설정 실패는 치명적이지 않다.
            log.debug("could not restrict permissions on {}: {}", path, e.getMessage());
        }
    }

    /** 테스트에서 저장 위치 확인용(package-private). */
    Path quarantineDir() {
        return quarantineDir;
    }
}

package com.portfolio.extension.service;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermission;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 보안 저장 파이프라인(#8) 단위 테스트. Spring 컨텍스트 없이 임시 디렉토리에 직접 검증한다.
 */
class StorageServiceTest {

    @Test
    void storesWithUuidNameStripsExecAndHidesOriginalName(@TempDir Path dir) throws Exception {
        StorageService storage = new StorageService(dir.toString(), 5_242_880);
        byte[] content = "hello".getBytes(StandardCharsets.UTF_8);

        StorageService.StoredFile stored = storage.store(content);

        // 파일명은 원본이 아니라 UUID (경로 조작/추측/덮어쓰기 방지)
        assertThat(stored.id()).matches("[0-9a-f-]{36}");
        assertThat(stored.size()).isEqualTo(content.length);

        Path saved = dir.resolve(stored.id());
        assertThat(Files.exists(saved)).isTrue();
        assertThat(Files.readAllBytes(saved)).isEqualTo(content);

        // POSIX 파일시스템이면 실행 비트가 없고 소유자 전용이어야 한다(rw-------).
        Set<PosixFilePermission> perms = tryPosix(saved);
        if (perms != null) {
            assertThat(perms).doesNotContain(
                    PosixFilePermission.OWNER_EXECUTE,
                    PosixFilePermission.GROUP_READ,
                    PosixFilePermission.GROUP_EXECUTE,
                    PosixFilePermission.OTHERS_READ,
                    PosixFilePermission.OTHERS_EXECUTE);
        }
    }

    @Test
    void rejectsOversizeContent(@TempDir Path dir) {
        StorageService storage = new StorageService(dir.toString(), 4); // 4바이트 상한
        assertThatThrownBy(() -> storage.store("too many bytes".getBytes(StandardCharsets.UTF_8)))
                .isInstanceOf(IllegalArgumentException.class);
    }

    private static Set<PosixFilePermission> tryPosix(Path path) {
        try {
            return Files.getPosixFilePermissions(path);
        } catch (Exception e) {
            return null; // 비-POSIX(Windows) 파일시스템
        }
    }
}

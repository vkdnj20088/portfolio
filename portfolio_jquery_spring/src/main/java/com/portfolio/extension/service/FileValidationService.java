package com.portfolio.extension.service;

import com.portfolio.extension.dto.FileValidationResponse;
import com.portfolio.extension.observability.FileValidationMetrics;
import org.apache.tika.detect.DefaultDetector;
import org.apache.tika.detect.Detector;
import org.apache.tika.io.TikaInputStream;
import org.apache.tika.metadata.Metadata;
import org.apache.tika.mime.MediaType;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * 파일 첨부 검증 - "확장자 차단만으로는 부족하다"를 코드로 보여주는 데모.
 *
 * 2단계 방어:
 *  1) 내용 기반(Magic Number): 확장자를 위조(virus.exe -> virus.jpg)해도 파일 시그니처로 실행파일을 잡는다.
 *  2) 정책 기반: 사용자가 설정한 차단 목록(고정 blocked=true ∪ 커스텀)에 걸리는 확장자를 거부한다.
 *
 * 내용 검사를 먼저 수행한다 - 확장자는 신뢰할 수 없기 때문.
 */
@Service
public class FileValidationService {

    private static final Logger log = LoggerFactory.getLogger(FileValidationService.class);

    /** 표시/정책 매칭에 사용할 안전한 확장자 형식. 미매치 파일명은 "확장자 없음"으로 처리(방어적). */
    private static final Pattern SAFE_EXTENSION = Pattern.compile("[a-z0-9]{1,20}");

    /**
     * 내용으로 판별됐을 때 차단하는 위험 콘텐츠 타입(실행/설치 계열 중 <b>매직넘버로 판별되는</b> 것).
     * 손코딩 4시그니처가 놓치는 넓은 집합을 Tika 의 유지되는 시그니처 DB 로 덮는다(예: RPM, 셸).
     *
     * <p>컨테이너 포맷(JAR/APK/DEB)은 여기에 두지 않는다 - 앞바이트만으론 평범한 zip/ar(docx,
     * 정적 라이브러리 등)과 구분되지 않아 이 매직 판별로는 도달할 수 없기 때문이다. 그들은
     * {@link #detectDangerousArchive(byte[])} 가 컨테이너 안을 들여다봐 별도로 잡는다.
     */
    private static final Set<String> DANGEROUS_MEDIA_TYPES = Set.of(
            "application/x-msdownload",
            "application/x-dosexec",
            "application/x-executable",
            "application/x-elf",
            "application/x-sharedlib",
            "application/x-mach-binary",
            "application/x-sh",
            "application/x-shellscript",
            "text/x-shellscript",
            "application/x-msdos-program",
            "application/x-rpm");

    /** ZIP 로컬 파일 헤더 시그니처("PK\x03\x04"). JAR/APK/docx 등이 공유한다. */
    private static final byte[] ZIP_MAGIC = {0x50, 0x4B, 0x03, 0x04};
    /** ar 아카이브 시그니처("!<arch>\n"). DEB/정적 라이브러리(.a)가 공유한다. */
    private static final byte[] AR_MAGIC = {0x21, 0x3C, 0x61, 0x72, 0x63, 0x68, 0x3E, 0x0A};
    /** 아카이브 엔트리/멤버 스캔 상한(엔트리 폭탄 방어). */
    private static final int MAX_ARCHIVE_ENTRIES = 256;

    private final BlockedExtensionProvider blockedExtensionProvider;
    private final FileValidationMetrics metrics;
    private final ContentInspectionBulkhead bulkhead;
    /** Tika 기본 판별기(내용 기반). 무상태라 재사용 안전. */
    private final Detector detector = new DefaultDetector();

    public FileValidationService(BlockedExtensionProvider blockedExtensionProvider,
            FileValidationMetrics metrics, ContentInspectionBulkhead bulkhead) {
        this.blockedExtensionProvider = blockedExtensionProvider;
        this.metrics = metrics;
        this.bulkhead = bulkhead;
    }

    /**
     * 검증 진입점 - 분류(classify)는 순수하게 두고, 여기서 소요 시간/사유별 계량과 구조화 로그(#O1)를
     * 한곳에서 처리한다(MDC 의 요청 상관 id 가 로그 패턴에 함께 실린다).
     */
    public FileValidationResponse validate(String filename, byte[] content) {
        long t0 = System.nanoTime();
        Result r = classify(filename, content);
        long elapsed = System.nanoTime() - t0;
        if (r.reason() == null) {
            metrics.passed(elapsed);
            log.info("event=file.validation.passed extension={}", r.response().extension());
        } else {
            metrics.blocked(r.reason(), elapsed);
            log.warn("event=file.validation.blocked reason={} extension={} detected={}",
                    r.reason().name().toLowerCase(), r.response().extension(),
                    r.response().detectedSignature());
        }
        return r.response();
    }

    private Result classify(String filename, byte[] content) {
        String extension = extractExtension(filename);

        // 1) 내용 기반(빠른 경로) - 흔한 실행파일 시그니처는 의존성 없이 즉시 차단
        String signature = detectExecutableSignature(content);
        if (signature != null) {
            return new Result(FileValidationResponse.block(
                    "파일 내용이 실행파일 시그니처(" + signature + ")입니다. 확장자와 무관하게 차단됩니다.",
                    extension, signature), FileValidationMetrics.BlockReason.MAGIC);
        }

        // 1-b/1-c) 심층 판별(Tika 매직 + 컨테이너 스캔)은 CPU 바운드라 벌크헤드 안에서 실행한다.
        //     두 단계를 한 번의 호출로 묶는 이유: permit 을 두 번 잡으면 "동시 4건"이 실제로는
        //     단계별 4건이 되어 상한 계산이 흐려지고, 두 단계 사이에서 다른 요청이 끼어들 수 있다.
        //     빠른 경로(1: 손코딩 시그니처)는 상수 시간이라 격리 대상이 아니다 - 오히려 격리하면
        //     스레드 전환 비용이 판별 비용보다 커진다.
        DeepInspection deep = bulkhead.call("deep-inspect", () -> new DeepInspection(
                detectDangerousMediaType(content), detectDangerousArchive(content)));

        String dangerousType = deep.mediaType();
        if (dangerousType != null) {
            return new Result(FileValidationResponse.block(
                    "파일 내용이 위험한 형식(" + dangerousType + ")으로 판별됐습니다. 확장자와 무관하게 차단됩니다.",
                    extension, dangerousType), FileValidationMetrics.BlockReason.CONTENT);
        }

        // 컨테이너 내용 검사 결과 - JAR/APK/DEB 는 앞바이트만으론 평범한 zip/ar 과 구분되지 않아
        // 매직 판별로는 도달할 수 없다. 아카이브 안의 시그니처 엔트리로만 판별해 평범한 zip(docx 등)은
        // 오차단하지 않으면서 실행 가능한 아카이브를 잡는다(위 벌크헤드 호출에서 함께 계산했다).
        String archiveType = deep.archiveType();
        if (archiveType != null) {
            return new Result(FileValidationResponse.block(
                    "파일 내용이 실행 가능한 아카이브(" + archiveType + ")로 판별됐습니다. 확장자와 무관하게 차단됩니다.",
                    extension, archiveType), FileValidationMetrics.BlockReason.ARCHIVE);
        }

        // 2) 정책 기반 - 설정된 차단 목록(캐시)
        if (extension != null && blockedExtensionProvider.current().contains(extension)) {
            return new Result(FileValidationResponse.block(
                    "차단 목록에 포함된 확장자입니다: " + extension, extension, null),
                    FileValidationMetrics.BlockReason.POLICY);
        }

        return new Result(FileValidationResponse.allow(extension), null);
    }

    /** 분류 결과 + 계량 사유(통과면 reason=null). */
    private record Result(FileValidationResponse response, FileValidationMetrics.BlockReason reason) {
    }

    /** 벌크헤드 안에서 한 번에 계산하는 심층 판별 결과(둘 다 null 이면 위험 신호 없음). */
    private record DeepInspection(String mediaType, String archiveType) {
    }

    private String extractExtension(String filename) {
        if (filename == null) {
            return null;
        }
        String name = canonicalizeFilename(filename);
        int dot = name.lastIndexOf('.');
        if (dot < 0 || dot == name.length() - 1) {
            return null;
        }
        String ext = name.substring(dot + 1);
        // 안전 형식이 아닌 토큰(경로/HTML 문자 등)은 확장자로 취급하지 않는다
        // -> 정책 매칭 일관성 + 파일명 기반 인젝션 방어 심층화(프론트 이스케이프와 이중).
        return SAFE_EXTENSION.matcher(ext).matches() ? ext : null;
    }

    /**
     * 파일명을 canonical 형태로 정리한 뒤 소문자화한다. 핵심은 <b>후행 노이즈 제거</b>다:
     * "installer.exe."(후행 점), "app.js "(NBSP), 후행 공백/제어/zero-width 문자는 OS/사람이
     * 무시하지만, 단순 {@code trim()}(ASCII 공백만 제거)은 이들을 남겨 실확장자가 가려진다. 그러면
     * {@link #extractExtension}가 null 을 돌려 정책-only(js/svg/html/커스텀) 차단이 통째로 우회됐다.
     * 후행에서 점과 이 노이즈들을 벗겨 진짜 확장자를 드러낸다(정상 파일명은 벗길 것이 없어 무영향).
     * 선행 노이즈도 표시 정합을 위해 제거한다(확장자 추출엔 영향 없음).
     */
    private static String canonicalizeFilename(String filename) {
        String lower = filename.toLowerCase(Locale.ROOT);
        int end = lower.length();
        while (end > 0 && (lower.charAt(end - 1) == '.' || isFilenameNoise(lower.charAt(end - 1)))) {
            end--;
        }
        int start = 0;
        while (start < end && isFilenameNoise(lower.charAt(start))) {
            start++;
        }
        return lower.substring(start, end);
    }

    /** 파일명에서 무시해야 할 노이즈 문자: 모든 유니코드 공백(NBSP/좁은NBSP 등)·제어·zero-width(BOM 등). */
    private static boolean isFilenameNoise(char c) {
        return Character.isWhitespace(c)
                || Character.isSpaceChar(c)
                || Character.isISOControl(c)
                || Character.getType(c) == Character.FORMAT;
    }

    /**
     * Tika 로 내용의 실제 콘텐츠 타입을 판별해, 위험군(실행/설치 계열)이면 그 MIME 을 돌려준다
     * (아니면 null). 메타데이터를 비워 순수 내용 기반으로만 판별하므로 확장자 위조에 흔들리지 않는다.
     */
    private String detectDangerousMediaType(byte[] content) {
        if (content == null || content.length == 0) {
            return null;
        }
        try (TikaInputStream in = TikaInputStream.get(content)) {
            MediaType type = detector.detect(in, new Metadata());
            String mime = type.getBaseType().toString();
            return DANGEROUS_MEDIA_TYPES.contains(mime) ? mime : null;
        } catch (IOException e) {
            // 판별 실패는 차단 근거로 삼지 않는다(가용성) - 빠른 경로와 정책이 여전히 방어한다.
            log.debug("content type detection failed: {}", e.getMessage());
            return null;
        }
    }

    /**
     * 컨테이너 내용을 들여다봐 JAR/APK/DEB 를 식별한다(아니면 null).
     *
     * <p>이들은 앞 몇 바이트만으론 평범한 컨테이너와 구분되지 않는다 - JAR/APK/docx 는 모두
     * {@code PK\x03\x04}(ZIP)로 시작하고, DEB/.a 정적 라이브러리는 모두 {@code !<arch>\n}(ar)로
     * 시작한다. 그래서 8바이트 창의 매직 판별로는 도달할 수 없었다. 컨테이너 안의 <b>시그니처
     * 엔트리</b>(JAR=META-INF/MANIFEST.MF/.class, APK=AndroidManifest.xml/classes.dex,
     * DEB=debian-binary)로만 위험을 판정하므로 평범한 zip(예: docx)은 오차단하지 않는다.
     */
    private String detectDangerousArchive(byte[] content) {
        if (hasPrefix(content, ZIP_MAGIC)) {
            return detectDangerousZip(content);
        }
        if (hasPrefix(content, AR_MAGIC)) {
            return detectDebianArchive(content);
        }
        return null;
    }

    private String detectDangerousZip(byte[] content) {
        try (ZipInputStream zis = new ZipInputStream(new ByteArrayInputStream(content))) {
            ZipEntry entry;
            int scanned = 0;
            while ((entry = zis.getNextEntry()) != null && scanned++ < MAX_ARCHIVE_ENTRIES) {
                String name = entry.getName();
                if ("META-INF/MANIFEST.MF".equals(name) || name.endsWith(".class")) {
                    return "JAR (" + name + ")";
                }
                if ("AndroidManifest.xml".equals(name) || "classes.dex".equals(name)) {
                    return "APK (" + name + ")";
                }
            }
        } catch (IOException e) {
            // 손상된 zip 은 차단 근거로 삼지 않는다(가용성) - 빠른 경로/정책이 여전히 방어한다.
            log.debug("zip inspection failed: {}", e.getMessage());
        }
        return null;
    }

    /**
     * ar 아카이브 멤버를 훑어 {@code debian-binary} 가 있으면 DEB 로 본다. ar 포맷: {@code !<arch>\n}(8B)
     * 뒤 60바이트 헤더가 이어지고, 헤더 앞 16B 가 멤버 이름, 오프셋 48의 10B 가 데이터 크기(ASCII)다.
     * 이름만 필요하므로 크기만큼(+2B 정렬 패딩) 건너뛰며 다음 헤더로 이동한다.
     */
    private String detectDebianArchive(byte[] content) {
        int pos = AR_MAGIC.length;
        for (int member = 0; member < MAX_ARCHIVE_ENTRIES && pos + 60 <= content.length; member++) {
            String name = new String(content, pos, 16, StandardCharsets.US_ASCII).trim();
            if (name.startsWith("debian-binary")) {
                return "DEB (ar: debian-binary)";
            }
            long dataSize;
            try {
                dataSize = Long.parseLong(new String(content, pos + 48, 10, StandardCharsets.US_ASCII).trim());
            } catch (NumberFormatException e) {
                break; // 헤더가 깨졌다 - 더 진행하지 않는다
            }
            if (dataSize < 0) {
                break;
            }
            long next = (long) pos + 60 + dataSize + (dataSize & 1L); // 멤버 데이터 + 2B 정렬 패딩
            if (next <= pos || next > content.length) {
                break; // 오버플로/역행/범위 밖 - 안전하게 중단
            }
            pos = (int) next;
        }
        return null;
    }

    private static boolean hasPrefix(byte[] content, byte[] magic) {
        if (content == null || content.length < magic.length) {
            return false;
        }
        for (int i = 0; i < magic.length; i++) {
            if (content[i] != magic[i]) {
                return false;
            }
        }
        return true;
    }

    /**
     * 파일 앞부분 바이트로 실행파일 시그니처를 감지한다.
     * PE/EXE(MZ), ELF, Mach-O, 스크립트 shebang(#!).
     */
    private String detectExecutableSignature(byte[] b) {
        if (b == null) {
            return null;
        }
        if (b.length >= 2 && u(b[0]) == 0x4D && u(b[1]) == 0x5A) {
            return "PE/EXE (MZ)";
        }
        if (b.length >= 4 && u(b[0]) == 0x7F && u(b[1]) == 0x45 && u(b[2]) == 0x4C && u(b[3]) == 0x46) {
            return "ELF";
        }
        if (b.length >= 4) {
            long magic = ((long) u(b[0]) << 24) | (u(b[1]) << 16) | (u(b[2]) << 8) | u(b[3]);
            if (magic == 0xFEEDFACEL || magic == 0xFEEDFACFL
                    || magic == 0xCEFAEDFEL || magic == 0xCFFAEDFEL) {
                return "Mach-O";
            }
        }
        if (b.length >= 2 && u(b[0]) == 0x23 && u(b[1]) == 0x21) {
            return "script (#!)";
        }
        return null;
    }

    private static int u(byte value) {
        return value & 0xFF;
    }
}

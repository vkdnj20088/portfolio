package com.portfolio.extension.service;

import com.portfolio.extension.domain.FixedExtension;
import com.portfolio.extension.dto.FileValidationResponse;
import com.portfolio.extension.repository.CustomExtensionRepository;
import com.portfolio.extension.repository.FixedExtensionRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.List;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
class FileValidationServiceTest {

    @Autowired
    private FileValidationService service;
    @Autowired
    private FixedExtensionService fixedExtensionService;
    @Autowired
    private FixedExtensionRepository fixedRepository;
    @Autowired
    private CustomExtensionRepository customRepository;
    @Autowired
    private BlockedExtensionProvider blockedExtensionProvider;

    @BeforeEach
    void reset() {
        customRepository.deleteAll();
        // 고정 확장자 blocked 플래그를 모두 off 로 초기화(테스트 간 상태 격리)
        List<FixedExtension> all = fixedRepository.findAll();
        all.forEach(f -> f.changeBlocked(false));
        fixedRepository.saveAll(all);
        blockedExtensionProvider.invalidate(); // 리포지토리 직접 변경분 캐시 반영
    }

    @Test
    void blocksDisguisedExecutableByMagicNumber() {
        // 확장자는 jpg 로 위장했지만 내용은 PE 실행파일(MZ)
        byte[] mz = {0x4D, 0x5A, 0x11, 0x22, 0, 0, 0, 0};
        FileValidationResponse res = service.validate("photo.jpg", mz);

        assertThat(res.allowed()).isFalse();
        assertThat(res.detectedSignature()).contains("MZ");
    }

    @Test
    void blocksElfByMagicNumber() {
        byte[] elf = {0x7F, 0x45, 0x4C, 0x46, 1, 1, 1, 0};
        assertThat(service.validate("image.png", elf).allowed()).isFalse();
    }

    @Test
    void blocksScriptByShebang() {
        byte[] sh = {0x23, 0x21, 0x2F, 0x62, 0x69, 0x6E, 0x2F, 0x73};
        assertThat(service.validate("readme.txt", sh).allowed()).isFalse();
    }

    @Test
    void blocksByPolicyWhenExtensionInBlocklist() {
        // 서비스 토글(@CacheEvict)로 차단 설정 -> 캐시가 즉시 갱신되어야 함
        fixedExtensionService.toggle("exe", true);

        byte[] harmless = "hello world".getBytes(StandardCharsets.UTF_8);
        FileValidationResponse res = service.validate("installer.exe", harmless);

        assertThat(res.allowed()).isFalse();
        assertThat(res.extension()).isEqualTo("exe");
        assertThat(res.detectedSignature()).isNull();
    }

    @Test
    void allowsHarmlessFileNotInBlocklist() {
        byte[] harmless = "just some notes".getBytes(StandardCharsets.UTF_8);
        FileValidationResponse res = service.validate("notes.txt", harmless);

        assertThat(res.allowed()).isTrue();
    }

    @Test
    void ignoresUnsafeFilenameToken() {
        // 파일명 기반 인젝션 방어: HTML 문자를 담은 "확장자"는 확장자로 취급하지 않는다(null)
        byte[] harmless = "x".getBytes(StandardCharsets.UTF_8);
        FileValidationResponse res = service.validate("a.<img src=x onerror=alert(1)>", harmless);

        assertThat(res.allowed()).isTrue();
        assertThat(res.extension()).isNull();
    }

    // ── 확장자 정책 우회 방어(파일명 canonical화) ──────────────────────────────
    // 후행 점/공백/NBSP/제어/zero-width 로 실확장자를 가려도 정책-only 차단이 뚫리지 않아야 한다.
    // 내용은 무해(harmless) 바이트라 콘텐츠 시그니처 계층은 관여하지 않는다 -> 순수 정책 경로 검증.

    @Test
    void blocksPolicyExtensionDespiteTrailingDot() {
        fixedExtensionService.toggle("exe", true);
        byte[] harmless = "hello".getBytes(StandardCharsets.UTF_8);
        FileValidationResponse res = service.validate("installer.exe.", harmless);

        assertThat(res.allowed()).isFalse();
        assertThat(res.extension()).isEqualTo("exe");
    }

    @Test
    void blocksPolicyExtensionDespiteMultipleTrailingDotsAndSpaces() {
        fixedExtensionService.toggle("exe", true);
        byte[] harmless = "hello".getBytes(StandardCharsets.UTF_8);
        // 후행 점 다중 + 일반 공백 + 탭
        assertThat(service.validate("installer.exe... \t", harmless).allowed()).isFalse();
    }

    @Test
    void blocksPolicyExtensionDespiteTrailingNbspAndUnicodeSpace() {
        fixedExtensionService.toggle("exe", true);
        byte[] harmless = "hello".getBytes(StandardCharsets.UTF_8);
        // U+00A0(NBSP), U+202F(narrow NBSP), U+FEFF(zero-width no-break) - trim() 이 못 벗기던 것들
        assertThat(service.validate("payload.exe\u00A0", harmless).allowed()).isFalse();
        assertThat(service.validate("payload.exe\u202F", harmless).allowed()).isFalse();
        assertThat(service.validate("payload.exe\uFEFF", harmless).allowed()).isFalse();
    }

    @Test
    void blocksPolicyExtensionCaseInsensitively() {
        fixedExtensionService.toggle("exe", true);
        byte[] harmless = "hello".getBytes(StandardCharsets.UTF_8);
        FileValidationResponse res = service.validate("INSTALLER.EXE", harmless);

        assertThat(res.allowed()).isFalse();
        assertThat(res.extension()).isEqualTo("exe");
    }

    @Test
    void usesLastTokenForMultiExtension() {
        fixedExtensionService.toggle("exe", true);
        byte[] harmless = "hello".getBytes(StandardCharsets.UTF_8);
        // 진짜 확장자는 마지막 토큰(OS/사람이 보는 것). exe 가 마지막이면 차단.
        assertThat(service.validate("archive.txt.exe", harmless).allowed()).isFalse();
        // exe 가 앞이고 마지막이 txt 면 그 파일은 .txt 로 취급 -> 정상 허용(오차단 아님).
        FileValidationResponse asTxt = service.validate("archive.exe.txt", harmless);
        assertThat(asTxt.allowed()).isTrue();
        assertThat(asTxt.extension()).isEqualTo("txt");
    }

    @Test
    void trailingDotDoesNotFabricateExtension() {
        // 후행 점만 있고 실제 확장자가 없는 이름은 "확장자 없음"(null)으로 남아야 한다(과다 스트립 방지).
        fixedExtensionService.toggle("exe", true);
        byte[] harmless = "hello".getBytes(StandardCharsets.UTF_8);
        FileValidationResponse res = service.validate("README.", harmless);

        assertThat(res.allowed()).isTrue();
        assertThat(res.extension()).isNull();
    }

    @Test
    void cleanFilenameExtractionUnchanged() {
        // 회귀 가드: 노이즈 없는 정상 파일명은 기존과 동일하게 동작(정책 미해당 -> 허용, 확장자 그대로).
        byte[] harmless = "hello".getBytes(StandardCharsets.UTF_8);
        FileValidationResponse res = service.validate("report.pdf", harmless);

        assertThat(res.allowed()).isTrue();
        assertThat(res.extension()).isEqualTo("pdf");
    }

    @Test
    void blocksInstallerPackageByContentType() {
        // 손코딩 4시그니처(MZ/ELF/Mach-O/#!)가 놓치는 위험 콘텐츠를 Tika 가 잡는다.
        // RPM 설치 패키지 매직(0xED 0xAB 0xEE 0xDB) - 확장자를 jpg 로 위조해도 내용으로 차단된다.
        byte[] rpm = {(byte) 0xED, (byte) 0xAB, (byte) 0xEE, (byte) 0xDB, 0, 0, 0, 0};
        FileValidationResponse res = service.validate("update.jpg", rpm);

        assertThat(res.allowed()).isFalse();
        assertThat(res.detectedSignature()).isNotNull(); // 판별된 위험 MIME
    }

    @Test
    void allowsSafeContentByContentType() {
        // 안전한 콘텐츠(PDF)는 내용 판별 계층에서도 통과한다.
        byte[] pdf = "%PDF-1.4\n1 0 obj\n".getBytes(StandardCharsets.UTF_8);
        assertThat(service.validate("doc.pdf", pdf).allowed()).isTrue();
    }

    // ── 컨테이너 내용 검사(JAR/APK/DEB) - 앞 8바이트로는 평범한 zip/ar 과 구분 불가했던 것 ──

    @Test
    void blocksJarByManifestEntry() throws Exception {
        // JAR 를 photo.jpg 로 위장 - 앞바이트는 평범한 zip(PK)과 동일하지만 내용에 MANIFEST 가 있다.
        byte[] jar = zip("META-INF/MANIFEST.MF", "Manifest-Version: 1.0\n");
        FileValidationResponse res = service.validate("photo.jpg", jar);

        assertThat(res.allowed()).isFalse();
        assertThat(res.detectedSignature()).contains("JAR");
    }

    @Test
    void blocksApkByAndroidManifestEntry() throws Exception {
        byte[] apk = zip("AndroidManifest.xml", "<manifest/>");
        FileValidationResponse res = service.validate("cat.png", apk);

        assertThat(res.allowed()).isFalse();
        assertThat(res.detectedSignature()).contains("APK");
    }

    @Test
    void allowsBenignZipContainer() throws Exception {
        // docx 형태의 평범한 zip - JAR/APK 시그니처 엔트리가 없으므로 오차단하지 않는다.
        byte[] docx = zip("[Content_Types].xml", "<Types/>");
        assertThat(service.validate("report.docx", docx).allowed()).isTrue();
    }

    @Test
    void blocksDebianArchiveByMember() {
        // ar 아카이브의 첫 멤버가 debian-binary 이면 DEB 로 판별해 차단한다(확장자 위장 무관).
        byte[] deb = arWithDebianBinary();
        FileValidationResponse res = service.validate("update.jpg", deb);

        assertThat(res.allowed()).isFalse();
        assertThat(res.detectedSignature()).contains("DEB");
    }

    /** 단일 엔트리를 담은 ZIP(PK\x03\x04 로 시작). */
    private static byte[] zip(String entryName, String content) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (ZipOutputStream zos = new ZipOutputStream(out)) {
            zos.putNextEntry(new ZipEntry(entryName));
            zos.write(content.getBytes(StandardCharsets.UTF_8));
            zos.closeEntry();
        }
        return out.toByteArray();
    }

    /** 첫 멤버 이름이 debian-binary 인 최소 ar 아카이브("!<arch>\n" + 60바이트 헤더). */
    private static byte[] arWithDebianBinary() {
        byte[] header = new byte[60];
        Arrays.fill(header, (byte) ' ');
        byte[] name = "debian-binary".getBytes(StandardCharsets.US_ASCII);
        System.arraycopy(name, 0, header, 0, name.length);
        header[48] = '0';   // size 필드 = 0(판별은 이름만 보므로 데이터 불필요)
        header[58] = '`';   // 헤더 종료 마커 "`\n"
        header[59] = '\n';

        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.writeBytes("!<arch>\n".getBytes(StandardCharsets.US_ASCII));
        out.writeBytes(header);
        return out.toByteArray();
    }
}

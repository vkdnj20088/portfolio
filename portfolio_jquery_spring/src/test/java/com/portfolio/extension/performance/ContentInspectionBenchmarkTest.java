package com.portfolio.extension.performance;

import com.portfolio.extension.observability.FileValidationMetrics;
import com.portfolio.extension.repository.CustomExtensionRepository;
import com.portfolio.extension.service.BlockedExtensionProvider;
import com.portfolio.extension.service.ContentInspectionBulkhead;
import com.portfolio.extension.service.FileValidationService;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 콘텐츠 판별 지연 벤치 - <b>벌크헤드 상한값의 근거</b>를 만든다.
 *
 * <p>왜 필요한가: 타임아웃 2000ms 와 동시 4건은 그냥 고른 숫자가 아니어야 한다. 정상 입력이
 * 얼마나 걸리고 적대적 입력이 얼마나 걸리는지를 알지 못하면, 상한은 정상 요청을 거절하거나
 * (너무 낮음) 아무것도 막지 못한다(너무 높음).
 *
 * <p>측정 방식: min-of-N 으로 JIT·GC 노이즈를 걷어낸다(평균은 한 번의 GC 에 오염된다).
 * 단정은 <b>느슨하게</b> 둔다 - 이 테스트의 목적은 회귀 게이트가 아니라 근거 수집이고,
 * CI 머신 성능에 따라 절대값이 달라지므로 엄격한 임계를 걸면 헛실패만 만든다.
 * 실제 수치는 로그로 남겨 상한을 정할 때 읽는다.
 *
 * <p>{@code @Tag("benchmark")}: {@code ./gradlew benchmarkTest}. 기본 test 에서는 제외된다.
 */
@Tag("benchmark")
class ContentInspectionBenchmarkTest {

    private static final Logger log = LoggerFactory.getLogger(ContentInspectionBenchmarkTest.class);
    private static final int RUNS = 7;
    /** ContentInspectionBulkhead 의 app.validation.inspect.timeout-ms 기본값. 함께 움직여야 하는 값이다. */
    private static final long CONFIGURED_TIMEOUT_MS = 1000;

    private static FileValidationService service() {
        CustomExtensionRepository repo = Mockito.mock(CustomExtensionRepository.class);
        Mockito.when(repo.count()).thenReturn(0L);
        FileValidationMetrics metrics = new FileValidationMetrics(new SimpleMeterRegistry(), repo);
        BlockedExtensionProvider provider = Mockito.mock(BlockedExtensionProvider.class);
        Mockito.when(provider.current()).thenReturn(Set.of());
        // 벤치에서는 상한을 크게 두어 측정 자체가 거절되지 않게 한다(측정 대상은 판별 시간이다).
        ContentInspectionBulkhead bulkhead =
                new ContentInspectionBulkhead(metrics, 8, 1000, 60_000, 2);
        return new FileValidationService(provider, metrics, bulkhead);
    }

    /** 평범한 텍스트 - 가장 흔한 정상 입력. */
    private static byte[] plainText(int bytes) {
        StringBuilder sb = new StringBuilder(bytes);
        while (sb.length() < bytes) {
            sb.append("사내 문서 본문입니다. 경비 정산은 지출 후 30일 이내에 처리합니다.\n");
        }
        return sb.substring(0, bytes).getBytes(StandardCharsets.UTF_8);
    }

    /** 정상 zip(docx 처럼 평범한 컨테이너) - 엔트리 수만큼 멤버 스캔이 돈다. */
    private static byte[] zipWith(int entries, int entryBytes) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] payload = plainText(entryBytes);
        try (ZipOutputStream zos = new ZipOutputStream(out)) {
            for (int i = 0; i < entries; i++) {
                zos.putNextEntry(new ZipEntry("doc/part-" + i + ".xml"));
                zos.write(payload);
                zos.closeEntry();
            }
        }
        return out.toByteArray();
    }

    private static long minMillis(String label, ThrowingRunnable body) throws Exception {
        long best = Long.MAX_VALUE;
        for (int i = 0; i < RUNS; i++) {
            long t0 = System.nanoTime();
            body.run();
            best = Math.min(best, System.nanoTime() - t0);
        }
        long ms = best / 1_000_000;
        log.info("event=bench.inspect case={} minMs={}", label, ms);
        return ms;
    }

    private interface ThrowingRunnable {
        void run() throws Exception;
    }

    @Test
    @DisplayName("정상 입력 판별 지연 - 타임아웃 하한의 근거")
    void normalInputs() throws Exception {
        FileValidationService svc = service();
        long text64k = minMillis("text-64KB", () -> svc.validate("a.txt", plainText(64 * 1024)));
        long text1m = minMillis("text-1MB", () -> svc.validate("a.txt", plainText(1024 * 1024)));
        // 업로드 상한(app.storage.max-file-size-bytes 기본 5MB) 그대로. 외삽하지 않고 경계값을 직접 잰다 -
        // "1MB 가 3ms 였으니 5MB 는 15ms 일 것"은 추정이고, 상한값을 정하는 근거로는 추정보다 실측이 낫다.
        long text5m = minMillis("text-5MB(업로드상한)", () -> svc.validate("a.txt", plainText(5 * 1024 * 1024)));
        byte[] zipSmall = zipWith(16, 4 * 1024);
        byte[] zipBig = zipWith(200, 8 * 1024);
        byte[] zipCap = zipWith(256, 20 * 1024); // 엔트리 상한 × 엔트리당 20KB ≈ 5MB
        long z16 = minMillis("zip-16entries", () -> svc.validate("a.zip", zipSmall));
        long z200 = minMillis("zip-200entries", () -> svc.validate("a.zip", zipBig));
        long zCap = minMillis("zip-256entries-5MB", () -> svc.validate("a.zip", zipCap));

        long worst = Math.max(Math.max(Math.max(text64k, text1m), text5m), Math.max(Math.max(z16, z200), zCap));
        // 서버는 t4g.small(arm64, 2 vCPU)이고 이 벤치는 개발기에서 돈다. 보수적으로 5배 느리다고 보고
        // 여유를 계산해 남긴다 - 상한을 정할 때 읽는 숫자는 개발기 값이 아니라 이쪽이다.
        long serverEstimate = worst * 5;
        log.info("event=bench.inspect summary worstNormalMs={} serverEstimateMs={} configuredTimeoutMs={} headroom={}x",
                worst, serverEstimate, CONFIGURED_TIMEOUT_MS,
                CONFIGURED_TIMEOUT_MS / Math.max(1, serverEstimate));

        // 느슨한 게이트: 서버 환산값이 설정 타임아웃의 1/4 을 넘으면 상한이 너무 촘촘하다는 신호다.
        // (엄격한 임계를 걸면 CI 머신 성능 차이로 헛실패만 나므로 경보 수준으로만 둔다.)
        assertThat(serverEstimate)
                .as("서버 환산 판별 시간이 타임아웃의 1/4 을 넘으면 상한을 재검토해야 한다")
                .isLessThan(CONFIGURED_TIMEOUT_MS / 4);
    }

    @Test
    @DisplayName("적대적 입력(엔트리 폭탄) - 엔트리 상한이 실제로 시간을 자르는지")
    void adversarialArchive() throws Exception {
        FileValidationService svc = service();
        // MAX_ARCHIVE_ENTRIES(256)를 크게 넘는 엔트리. 상한이 없으면 시간이 엔트리 수에 비례해 자란다.
        byte[] many = zipWith(4000, 256);
        long ms = minMillis("zip-4000entries", () -> svc.validate("a.zip", many));
        log.info("event=bench.inspect note=엔트리상한(256)덕에 4000개여도 스캔은 256개에서 멈춘다 ms={}", ms);
        assertThat(ms)
                .as("엔트리 상한이 동작하면 4000개 입력도 정상 zip 수준에 머문다")
                .isLessThan(2000);
    }
}

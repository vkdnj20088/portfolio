package com.portfolio.extension.service;

import com.portfolio.extension.domain.RelayAttempt;
import com.portfolio.extension.domain.RelayJob;
import com.portfolio.extension.relay.Mulberry32;
import com.portfolio.extension.relay.RelayJobStatus;
import com.portfolio.extension.relay.RelayJobType;
import com.portfolio.extension.relay.RelayPublishMode;
import com.portfolio.extension.relay.RelayScenario;
import com.portfolio.extension.repository.RelayAttemptRepository;
import com.portfolio.extension.repository.RelayJobRepository;
import com.portfolio.extension.repository.RelayOutboxRepository;
import java.time.Duration;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

/**
 * 파이프라인 E2E - 실제 스케줄러·워커·발행기가 도는 컨텍스트에서 상태 전이를 실측한다.
 * H2(MySQL 모드)가 {@code FOR UPDATE SKIP LOCKED} 를 실행하는 것 자체가 이 스위트의
 * 검증 대상이다(로컬 무설정 실행의 전제). 다중 워커 상호배제는 Testcontainers IT 의 몫.
 *
 * <p>백오프가 실제 시간(1s 기저)이라 이 스위트는 수 초를 기다린다 - 표시값과 실행값을
 * 같게 두는 제품 결정의 비용이고, 감수한다(빨리 끝내려고 테스트만 다른 시간을 쓰면
 * 그 순간부터 테스트가 다른 제품을 검증한다).
 */
@SpringBootTest(properties = {
        "app.relay.worker.tick-ms=100",
        "app.relay.publisher.tick-ms=100",
        "app.relay.seed.enabled=false",
})
class RelayPipelineFlowTest {

    @Autowired
    private RelayJobService service;
    @Autowired
    private RelayJobRepository jobs;
    @Autowired
    private RelayAttemptRepository attempts;
    @Autowired
    private RelayOutboxRepository outbox;

    private RelayJobService.EnqueueResult enqueue(String key, RelayScenario scenario, int maxAttempts,
            RelayPublishMode mode, boolean failPersist) {
        return service.enqueue(key, RelayJobType.WEBHOOK_PUSH, "flow-test", scenario,
                Mulberry32.hashSeed(key), maxAttempts, mode, failPersist);
    }

    @Test
    void thirdTimeLucky_failsTwiceThenSucceeds_withMonotoneBackoffAndPublishedOutbox() {
        String key = "flow-3rd-lucky";
        enqueue(key, RelayScenario.THIRD_TIME_LUCKY, 3, RelayPublishMode.OUTBOX, false);

        Long id = jobs.findByIdempotencyKey(key).orElseThrow().getId();
        await().atMost(Duration.ofSeconds(20)).untilAsserted(() ->
                assertThat(jobs.findById(id).orElseThrow().getStatus()).isEqualTo(RelayJobStatus.SUCCEEDED));

        List<RelayAttempt> history = attempts.findByJobIdOrderByRunAscAttemptNoAsc(id);
        assertThat(history).hasSize(3);
        assertThat(history.get(0).isSuccess()).isFalse();
        assertThat(history.get(1).isSuccess()).isFalse();
        assertThat(history.get(2).isSuccess()).isTrue();
        assertThat(history.get(0).getErrorCode()).isNotNull();
        // 백오프는 단조 증가(지수 + 시드 지터)
        assertThat(history.get(1).getBackoffMs()).isGreaterThan(history.get(0).getBackoffMs());
        // 이력 각 행에 워커 cid 가 있다(로그와 화면이 같은 식별자로 만난다)
        assertThat(history).allSatisfy(a -> assertThat(a.getCid()).isNotBlank());

        // 아웃박스: 이 작업의 예약 + 완료 이벤트가 커밋됐고 발행기가 곧 발행한다.
        // (전역 카운터가 아니라 키 범위로 본다 - 다른 테스트의 주입 유령과 간섭하지 않게.)
        await().atMost(Duration.ofSeconds(5)).untilAsserted(() ->
                assertThat(outbox.findAll().stream()
                        .filter(e -> e.getAggregateKey().equals(key)))
                        .hasSize(2)
                        .allSatisfy(e -> assertThat(e.getPublishedAt()).isNotNull()));
    }

    @Test
    void deadLetter_thenReprocess_reproducesIdenticalTimeline() {
        String key = "flow-dead-letter";
        enqueue(key, RelayScenario.ALWAYS_FAIL, 2, RelayPublishMode.OUTBOX, false);
        Long id = jobs.findByIdempotencyKey(key).orElseThrow().getId();

        await().atMost(Duration.ofSeconds(15)).untilAsserted(() ->
                assertThat(jobs.findById(id).orElseThrow().getStatus()).isEqualTo(RelayJobStatus.DEAD_LETTER));
        List<RelayAttempt> firstRun = attempts.findByJobIdOrderByRunAscAttemptNoAsc(id);
        assertThat(firstRun).hasSize(2);

        // 수동 재처리 - 멱등 키·시드 불변이므로 두 번째 세대는 같은 타임라인을 재현해야 한다.
        service.reprocess(id);
        await().atMost(Duration.ofSeconds(15)).untilAsserted(() ->
                assertThat(jobs.findById(id).orElseThrow().getStatus()).isEqualTo(RelayJobStatus.DEAD_LETTER));

        List<RelayAttempt> all = attempts.findByJobIdOrderByRunAscAttemptNoAsc(id);
        assertThat(all).hasSize(4);
        RelayJob job = jobs.findById(id).orElseThrow();
        assertThat(job.getRun()).isEqualTo(1);
        for (int i = 0; i < 2; i++) {
            RelayAttempt run0 = all.get(i);
            RelayAttempt run1 = all.get(i + 2);
            assertThat(run1.getRun()).isEqualTo(1);
            assertThat(run1.getAttemptNo()).isEqualTo(run0.getAttemptNo());
            // 결정성의 눈 증명: 세대가 달라도 성패·사유·백오프가 같다
            assertThat(run1.isSuccess()).isEqualTo(run0.isSuccess());
            assertThat(run1.getErrorCode()).isEqualTo(run0.getErrorCode());
            assertThat(run1.getBackoffMs()).isEqualTo(run0.getBackoffMs());
        }
    }

    @Test
    void duplicateKey_returnsExistingJobInsteadOfError() {
        String key = "flow-idem";
        RelayJobService.EnqueueResult first = enqueue(key, RelayScenario.ALWAYS_SUCCEED, 3,
                RelayPublishMode.OUTBOX, false);
        RelayJobService.EnqueueResult second = enqueue(key, RelayScenario.ALWAYS_SUCCEED, 3,
                RelayPublishMode.OUTBOX, false);

        assertThat(first.duplicate()).isFalse();
        assertThat(second.duplicate()).isTrue();
        assertThat(second.job().getId()).isEqualTo(first.job().getId());
        assertThat(jobs.findByIdempotencyKey(key)).isPresent();
    }

    @Test
    void persistFailure_outboxModeLeavesNothing_directModeLeavesGhostEvent() {
        // 아웃박스 모드 + 저장 실패: 원본도 이벤트도 함께 구른다 - 흔적 0.
        String outboxKey = "flow-ghost-outbox";
        RelayJobService.EnqueueResult r1 = enqueue(outboxKey, RelayScenario.ALWAYS_SUCCEED, 3,
                RelayPublishMode.OUTBOX, true);
        assertThat(r1.persisted()).isFalse();
        assertThat(jobs.findByIdempotencyKey(outboxKey)).isEmpty();
        assertThat(outbox.findAll().stream()
                .filter(e -> e.getAggregateKey().equals(outboxKey))).isEmpty();

        // 직접 발행 모드 + 저장 실패: 원본은 없는데 이벤트만 나갔다 - 유령 1.
        String directKey = "flow-ghost-direct";
        RelayJobService.EnqueueResult r2 = enqueue(directKey, RelayScenario.ALWAYS_SUCCEED, 3,
                RelayPublishMode.DIRECT, true);
        assertThat(r2.persisted()).isFalse();
        assertThat(jobs.findByIdempotencyKey(directKey)).isEmpty();
        assertThat(outbox.findAll().stream()
                .filter(e -> e.getAggregateKey().equals(directKey))
                .filter(e -> e.getPublishedAt() != null)).hasSize(1);
        assertThat(outbox.countGhostEvents()).isGreaterThanOrEqualTo(1);
    }
}

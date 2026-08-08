package com.portfolio.extension.controller;

import com.portfolio.extension.domain.RelayAttempt;
import com.portfolio.extension.domain.RelayJob;
import com.portfolio.extension.dto.RelayDtos.EnqueueRequest;
import com.portfolio.extension.dto.RelayDtos.EnqueueResponse;
import com.portfolio.extension.dto.RelayDtos.JobListResponse;
import com.portfolio.extension.dto.RelayDtos.JobResponse;
import com.portfolio.extension.dto.RelayDtos.StatsResponse;
import com.portfolio.extension.exception.RelayJobNotFoundException;
import com.portfolio.extension.relay.Mulberry32;
import com.portfolio.extension.relay.RelayJobStatus;
import com.portfolio.extension.repository.RelayAttemptRepository;
import com.portfolio.extension.repository.RelayJobRepository;
import com.portfolio.extension.service.RelayJobService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 작업 재시도 파이프라인 API. 실행은 결정적 시뮬레이션이고 외부 호출은 없다(§0).
 * 응답의 상태·오류는 enum 코드다 - 표시 문자열은 클라이언트가 조립한다.
 */
@Tag(name = "작업 릴레이", description = "실패하는 작업의 예약·재시도·격리(DLQ)·아웃박스 - 결정적 실패 주입 데모")
@RestController
@RequestMapping("/api/relay")
public class RelayJobController {

    private final RelayJobService service;
    private final RelayJobRepository jobs;
    private final RelayAttemptRepository attempts;

    public RelayJobController(RelayJobService service, RelayJobRepository jobs,
            RelayAttemptRepository attempts) {
        this.service = service;
        this.jobs = jobs;
        this.attempts = attempts;
    }

    @Operation(summary = "작업 예약",
            description = "같은 멱등 키의 재요청은 오류가 아니라 기존 작업을 돌려주는 200 이다(duplicate=true). "
                    + "failPersist=true 는 아웃박스 비교용 저장 실패 주입 - persisted=false 로 돌아온다.")
    @PostMapping("/jobs")
    public ResponseEntity<EnqueueResponse> enqueue(@Valid @RequestBody EnqueueRequest req) {
        String key = (req.idempotencyKey() == null || req.idempotencyKey().isBlank())
                ? "job-" + UUID.randomUUID().toString().substring(0, 8)
                : req.idempotencyKey();
        int seed = req.seed() != null ? req.seed() : Mulberry32.hashSeed(key);

        RelayJobService.EnqueueResult result = service.enqueue(key, req.type(), req.payload(),
                req.scenario(), seed, req.maxAttempts(), req.publishMode(), req.failPersist());

        if (!result.persisted()) {
            // 주입된 저장 실패 - 커밋된 작업이 없다. 화면은 유령 카운터 변화로 두 모드를 비교한다.
            return ResponseEntity.ok(new EnqueueResponse(null, false, false));
        }
        JobResponse job = JobResponse.from(result.job(),
                attempts.findByJobIdOrderByRunAscAttemptNoAsc(result.job().getId()));
        return result.duplicate()
                ? ResponseEntity.ok(new EnqueueResponse(job, true, true))
                : ResponseEntity.status(HttpStatus.CREATED).body(new EnqueueResponse(job, false, true));
    }

    @Operation(summary = "최근 작업 목록 + 큐 현황", description = "시도 이력을 포함한 최근 20건. status 로 필터(예: DEAD_LETTER).")
    @GetMapping("/jobs")
    public JobListResponse list(@RequestParam(required = false) RelayJobStatus status) {
        List<RelayJob> recent = (status == null)
                ? jobs.findTop20ByOrderByCreatedAtDescIdDesc()
                : jobs.findTop20ByStatusOrderByUpdatedAtDescIdDesc(status);
        List<Long> ids = recent.stream().map(RelayJob::getId).toList();
        Map<Long, List<RelayAttempt>> byJob = new HashMap<>();
        if (!ids.isEmpty()) {
            attempts.findByJobIdInOrderByJobIdAscRunAscAttemptNoAsc(ids)
                    .forEach(a -> byJob.computeIfAbsent(a.getJobId(), k -> new java.util.ArrayList<>()).add(a));
        }
        List<JobResponse> jobDtos = recent.stream()
                .map(j -> JobResponse.from(j, byJob.getOrDefault(j.getId(), List.of())))
                .toList();
        RelayJobService.QueueStats stats = service.stats();
        return new JobListResponse(jobDtos,
                new StatsResponse(stats.byStatus(), stats.outboxPending(), stats.ghostEvents()));
    }

    @Operation(summary = "작업 단건 + 시도 타임라인")
    @GetMapping("/jobs/{id}")
    public JobResponse get(@PathVariable Long id) {
        RelayJob job = jobs.findById(id).orElseThrow(() -> new RelayJobNotFoundException(id));
        return JobResponse.from(job, attempts.findByJobIdOrderByRunAscAttemptNoAsc(id));
    }

    @Operation(summary = "작업 취소", description = "PENDING/RETRYING 만 가능. RUNNING 이면 409(ILLEGAL_TRANSITION).")
    @PostMapping("/jobs/{id}/cancel")
    public JobResponse cancel(@PathVariable Long id) {
        RelayJob job = service.cancel(id);
        return JobResponse.from(job, attempts.findByJobIdOrderByRunAscAttemptNoAsc(id));
    }

    @Operation(summary = "격리(DLQ) 작업 수동 재처리",
            description = "DEAD_LETTER 만 가능. 멱등 키가 그대로라 재처리가 중복 실행을 만들지 않는다.")
    @PostMapping("/jobs/{id}/reprocess")
    public JobResponse reprocess(@PathVariable Long id) {
        RelayJob job = service.reprocess(id);
        return JobResponse.from(job, attempts.findByJobIdOrderByRunAscAttemptNoAsc(id));
    }

    @Operation(summary = "큐 현황", description = "상태별 건수 + 아웃박스 미발행·유령 이벤트 수.")
    @GetMapping("/stats")
    public StatsResponse stats() {
        RelayJobService.QueueStats s = service.stats();
        return new StatsResponse(s.byStatus(), s.outboxPending(), s.ghostEvents());
    }
}

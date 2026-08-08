package com.portfolio.extension.dto;

import com.portfolio.extension.domain.RelayAttempt;
import com.portfolio.extension.domain.RelayJob;
import com.portfolio.extension.relay.RelayJobStatus;
import com.portfolio.extension.relay.RelayJobType;
import com.portfolio.extension.relay.RelayPublishMode;
import com.portfolio.extension.relay.RelayScenario;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * 재시도 파이프라인 API 계약. 서버는 <b>코드(enum)와 값만</b> 내려보낸다 - 상태명·오류
 * 사유·버튼 문구의 표시 문자열은 전부 클라이언트(relayMessages.ts)가 조립한다. 서버가
 * 한국어 문장을 만들면 현지화 라운드에서 서버가 로케일을 알아야 한다(i18n 사전 조치).
 *
 * <p>시각은 UTC {@link Instant}(ISO-8601 Z) - IP 데모와 같은 규칙(저장은 절대 시점,
 * 표시는 보는 기기 시간대).
 */
public final class RelayDtos {

    private RelayDtos() {
    }

    /** 예약 요청. 멱등 키는 비우면 서버가 발급한다(폼의 "새 키" 편의). */
    public record EnqueueRequest(
            @Size(max = 64) @Pattern(regexp = "[A-Za-z0-9._-]*",
                    message = "멱등 키는 영숫자·점·하이픈·언더스코어만") String idempotencyKey,
            @NotNull RelayJobType type,
            @Size(max = 200) String payload,
            @NotNull RelayScenario scenario,
            /** 시드 - 비우면 서버가 키에서 파생. 같은 시드는 같은 타임라인(화면 재생용). */
            Integer seed,
            @NotNull @Min(1) @Max(5) Integer maxAttempts,
            @NotNull RelayPublishMode publishMode,
            /** 아웃박스 비교 데모 - 저장 트랜잭션 강제 롤백(실패 주입). */
            boolean failPersist) {
    }

    public record EnqueueResponse(
            /** 저장 실패 주입 경로면 null(커밋된 작업이 없다). */
            JobResponse job,
            boolean duplicate,
            boolean persisted) {
    }

    public record AttemptResponse(
            /** 재처리 세대(0부터) - 세대별 타임라인을 나란히 보여 결정성을 증명한다. */
            int run,
            int attemptNo,
            Instant startedAt,
            boolean success,
            /** RelayErrorCode 이름. 성공이면 null. 문구는 클라 카탈로그가 조립. */
            String errorCode,
            long backoffMs,
            String cid) {

        public static AttemptResponse from(RelayAttempt a) {
            return new AttemptResponse(a.getRun(), a.getAttemptNo(), a.getStartedAt(), a.isSuccess(),
                    a.getErrorCode() == null ? null : a.getErrorCode().name(),
                    a.getBackoffMs(), a.getCid());
        }
    }

    public record JobResponse(
            Long id,
            String idempotencyKey,
            RelayJobType type,
            String payload,
            RelayJobStatus status,
            int attemptCount,
            int maxAttempts,
            int seed,
            RelayScenario scenario,
            int run,
            Instant nextAttemptAt,
            String enqueueCid,
            Instant createdAt,
            Instant updatedAt,
            List<AttemptResponse> attempts) {

        public static JobResponse from(RelayJob j, List<RelayAttempt> attempts) {
            return new JobResponse(j.getId(), j.getIdempotencyKey(), j.getType(), j.getPayload(),
                    j.getStatus(), j.getAttemptCount(), j.getMaxAttempts(), j.getSeed(),
                    j.getScenario(), j.getRun(), j.getNextAttemptAt(), j.getEnqueueCid(),
                    j.getCreatedAt(), j.getUpdatedAt(),
                    attempts.stream().map(AttemptResponse::from).toList());
        }
    }

    public record StatsResponse(
            Map<RelayJobStatus, Long> byStatus,
            long outboxPending,
            long ghostEvents) {
    }

    public record JobListResponse(List<JobResponse> jobs, StatsResponse stats) {
    }
}

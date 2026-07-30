package com.portfolio.extension.controller;

import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;
import org.springframework.http.MediaType;
import org.springframework.http.HttpHeaders;
import java.nio.charset.StandardCharsets;
import java.io.Writer;
import java.io.UncheckedIOException;
import java.io.OutputStreamWriter;
import java.io.IOException;
import java.io.BufferedWriter;
import com.portfolio.extension.domain.IpAuditAction;
import com.portfolio.extension.dto.IpAuditListResponse;
import com.portfolio.extension.dto.IpMatchResponse;
import com.portfolio.extension.dto.PolicyEvaluationResponse;
import com.portfolio.extension.dto.IpRuleCreateRequest;
import com.portfolio.extension.dto.IpRuleUpdateRequest;
import com.portfolio.extension.dto.IpRuleListResponse;
import com.portfolio.extension.dto.IpRuleResponse;
import com.portfolio.extension.dto.WhoAmIResponse;
import com.portfolio.extension.exception.InvalidIpException;
import com.portfolio.extension.net.IpCidr;
import com.portfolio.extension.observability.IpMetrics;
import com.portfolio.extension.service.IpAccessRuleService;
import com.portfolio.extension.service.IpPolicyEvaluator;
import com.portfolio.extension.service.IpAuditService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.time.Instant;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 허용 IP 접근 규칙 어드민 API.
 * 검색 파라미터의 시각은 애매함을 피하려 epoch millis(long)로 받는다(프론트가 기기 시간대로 계산).
 */
@Tag(name = "IP 접근 규칙", description = "허용 IP/CIDR·사용 시간대 등록·수정·삭제·검색, 포함(containment) 조회, 변경 감사")
@RestController
@RequestMapping("/api/ip-rules")
public class IpAccessRuleController {

    /** CSV 내보내기 안전 상한. 무제한 내보내기는 실수 한 번이 곧 장시간 부하다. */
    private static final int AUDIT_EXPORT_MAX = 200_000;

    private final IpAccessRuleService service;
    private final IpAuditService auditService;
    private final IpMetrics metrics;
    private final IpPolicyEvaluator evaluator;

    public IpAccessRuleController(IpAccessRuleService service, IpAuditService auditService,
            IpMetrics metrics, IpPolicyEvaluator evaluator) {
        this.service = service;
        this.auditService = auditService;
        this.metrics = metrics;
        this.evaluator = evaluator;
    }

    @GetMapping
    public IpRuleListResponse list(
            @RequestParam(required = false) String q,
            @RequestParam(required = false) Long startFrom, // epoch millis(사용 시작 시간 하한)
            @RequestParam(required = false) Long endTo,      // epoch millis(사용 끝 시간 상한)
            @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "30") int size) {
        return service.list(q,
                startFrom == null ? null : Instant.ofEpochMilli(startFrom),
                endTo == null ? null : Instant.ofEpochMilli(endTo),
                cursor, size);
    }

    @PostMapping
    public ResponseEntity<IpRuleResponse> create(@Valid @RequestBody IpRuleCreateRequest request,
            HttpServletRequest http) {
        return ResponseEntity.status(HttpStatus.CREATED).body(service.create(request, clientIp(http))); // 201
    }

    @PutMapping("/{id}")
    @Operation(summary = "IP 규칙 수정", description = "IP/CIDR·설명·사용 기간을 수정한다. 낙관적 락(@Version)이 "
            + "동시 수정 충돌을 409 로 막고, 변경은 감사 로그(UPDATE)에 남는다.")
    public IpRuleResponse update(@PathVariable Long id, @Valid @RequestBody IpRuleUpdateRequest request,
            HttpServletRequest http) {
        return service.update(id, request, clientIp(http)); // 200 / 404 / 400 / 409(락 충돌)
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable Long id, HttpServletRequest http) {
        service.delete(id, clientIp(http));
        return ResponseEntity.noContent().build(); // 204
    }

    /**
     * 대역 포함 조회(#I6): "이 IP 를 포함하는 규칙" 을 (ip_start, ip_end) 인덱스로 찾는다.
     * DB 무관 순수 판정인 /match 와 달리, 여기서는 대량 규칙에서 인덱스 범위 스캔으로 조회한다.
     */
    @GetMapping("/containing")
    public List<IpRuleResponse> containing(@RequestParam String ip,
            @RequestParam(defaultValue = "30") int size) {
        parseOr400(ip, "IP"); // 형식 검증(잘못된 IP 는 400)
        return service.findContaining(ip, size);
    }

    /**
     * 변경 감사 로그(누가/언제/무엇). 규칙 목록과 동일한 키셋 페이지네이션을 재사용한다.
     *
     * <p>필터(#G2): 행위·대상 IP·행위자·기간. 감사 로그는 쌓는 것보다 <b>찾는 것</b>이 본질이라
     * 필터가 없으면 심사에서 쓸 수 없다. 문자열 조건은 접두 일치만 받는다(중간 일치는 인덱스를
     * 못 타 100만 건에서 풀스캔이 된다 - 자세한 근거는 IpAuditService.filters).
     */
    @GetMapping("/audit")
    public IpAuditListResponse audit(
            @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "30") int size,
            @RequestParam(required = false) IpAuditAction action,
            @RequestParam(required = false) String ip,
            @RequestParam(required = false) String actor,
            @RequestParam(required = false) Long from, // epoch millis
            @RequestParam(required = false) Long to) {
        return auditService.list(cursor, size, auditFilter(action, ip, actor, from, to));
    }

    /**
     * 감사 로그 CSV 내보내기(#G2) - {@link StreamingResponseBody} 로 <b>스트리밍</b>한다.
     *
     * <p>String 을 만들어 반환하면 100만 건에서 힙이 먼저 죽는다. 감사 기능이 서비스를 내리는
     * 형태는 감사가 없는 것보다 나쁘다. 이미 있는 키셋 페이지네이션 위에 반복을 얹어 한 페이지씩
     * 흘려보내므로 메모리 사용량이 행 수와 무관하다.
     *
     * <p>Content-Disposition 의 파일명은 고정 문자열이다 - 사용자 입력을 파일명에 넣으면 헤더
     * 인젝션 표면이 생긴다.
     */
    @GetMapping(value = "/audit.csv", produces = "text/csv")
    public ResponseEntity<StreamingResponseBody> auditCsv(
            @RequestParam(required = false) IpAuditAction action,
            @RequestParam(required = false) String ip,
            @RequestParam(required = false) String actor,
            @RequestParam(required = false) Long from,
            @RequestParam(required = false) Long to,
            @RequestParam(defaultValue = "10000") int maxRows) {
        IpAuditService.AuditFilter filter = auditFilter(action, ip, actor, from, to);
        int cap = Math.min(Math.max(maxRows, 1), AUDIT_EXPORT_MAX);
        StreamingResponseBody body = out -> {
            Writer w = new BufferedWriter(new OutputStreamWriter(out, StandardCharsets.UTF_8));
            // BOM - 엑셀이 UTF-8 CSV 를 로컬 인코딩으로 읽어 한글이 깨지는 것을 막는다.
            w.write('\uFEFF');
            auditService.exportCsv(filter, cap, line -> {
                try {
                    w.write(line);
                } catch (IOException e) {
                    // 클라이언트가 중간에 끊은 경우가 대부분이다. 반복을 멈추기 위해 런타임으로 감싼다.
                    throw new UncheckedIOException(e);
                }
            });
            w.flush();
        };
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"ip-audit.csv\"")
                .header(HttpHeaders.CACHE_CONTROL, "no-store") // 감사 데이터는 중간 캐시에 남기지 않는다
                .contentType(MediaType.parseMediaType("text/csv; charset=UTF-8"))
                .body(body);
    }

    private static IpAuditService.AuditFilter auditFilter(IpAuditAction action, String ip,
            String actor, Long from, Long to) {
        return new IpAuditService.AuditFilter(action, ip, actor,
                from == null ? null : Instant.ofEpochMilli(from),
                to == null ? null : Instant.ofEpochMilli(to));
    }

    /**
     * 본인 IP 자동기입용. Nginx 뒤(prod)에서는 server.forward-headers-strategy=framework 로
     * X-Forwarded-For 를 반영해 getRemoteAddr() 가 실제 클라이언트 IP 를 준다(신뢰 경계 = Nginx 만,
     * 앱은 127.0.0.1 루프백 바인딩이라 XFF 를 세팅하는 주체가 Nginx 로 한정된다).
     */
    @GetMapping("/whoami")
    public WhoAmIResponse whoami(HttpServletRequest request) {
        return new WhoAmIResponse(clientIp(request));
    }

    // 클라이언트 IP - 감사 행위자/whoami 공통. IPv6 루프백 표기를 정리한다(로컬 데모 가독성).
    private static String clientIp(HttpServletRequest request) {
        String ip = request.getRemoteAddr();
        return "0:0:0:0:0:0:0:1".equals(ip) ? "127.0.0.1" : ip;
    }

    /**
     * 포함(containment) 판정 - "이 규칙(IP/CIDR)이 이 대상 IP 를 포함하나". DB 를 타지 않는 순수 계산으로,
     * 프론트가 규칙 입력칸 옆에 "내 IP 포함/미포함" 배지를 즉시 보여주는 데 쓴다. 잘못된 입력은 400.
     */
    @GetMapping("/match")
    public IpMatchResponse match(@RequestParam String rule, @RequestParam String target) {
        IpCidr r = parseOr400(rule, "규칙");
        IpCidr t = parseOr400(target, "대상 IP");
        long t0 = System.nanoTime();
        boolean matched = r.contains(t);
        metrics.recordMatch(matched, System.nanoTime() - t0); // 결과 카운터 + 소요 타이머
        return new IpMatchResponse(rule, target, r.canonical(), t.canonical(), t.family().name(), matched);
    }

    /**
     * 정책 평가(#G1) - "이 IP 는 지금 허용되나, 그리고 왜 그런가".
     *
     * <p>{@code /match} 와의 차이: match 는 <b>규칙 하나</b>와 IP 하나의 포함 관계를 답하는 순수
     * 계산이고, 여기는 <b>규칙 집합 전체</b>를 평가 순서대로 훑어 최종 판정과 근거를 답한다.
     * 전자는 입력칸 옆 배지용, 후자는 정책 시뮬레이터용이다.
     *
     * <p>{@code at} 을 받는 이유: 시간 창이 판정에 들어가므로 "지금"이 아닌 시점을 물어볼 수 있어야
     * 한다("다음 주 월요일에 이 IP 가 들어올 수 있나"). 생략하면 현재 시각으로 평가한다.
     * 이것이 시뮬레이터를 <b>예측 도구</b>로 만드는 지점이다 - 규칙을 고치기 전에 결과를 본다.
     */
    @GetMapping("/evaluate")
    public PolicyEvaluationResponse evaluate(
            @RequestParam String target,
            @RequestParam(required = false) Long at) {
        parseOr400(target, "대상 IP"); // 형식 오류를 400 으로 먼저 거른다(평가기 안에서 터지지 않게)
        Instant when = at == null ? Instant.now() : Instant.ofEpochMilli(at);
        // 후보를 범위 인덱스로 좁혀 넘긴다(idx_ip_range). 전체를 넘겨도 결과는 같지만, 규칙이
        // 100만 건인 데모에서 전량 로드는 평가가 아니라 사고다.
        return evaluator.evaluate(target, service.findContainingForEvaluation(target), when);
    }

    private static IpCidr parseOr400(String value, String label) {
        try {
            return IpCidr.parse(value);
        } catch (IllegalArgumentException e) {
            throw new InvalidIpException(label + " 값이 올바르지 않습니다: " + e.getMessage());
        }
    }
}

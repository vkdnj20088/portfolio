package com.portfolio.extension.controller;

import com.portfolio.extension.dto.IpAuditListResponse;
import com.portfolio.extension.dto.IpMatchResponse;
import com.portfolio.extension.dto.IpRuleCreateRequest;
import com.portfolio.extension.dto.IpRuleUpdateRequest;
import com.portfolio.extension.dto.IpRuleListResponse;
import com.portfolio.extension.dto.IpRuleResponse;
import com.portfolio.extension.dto.WhoAmIResponse;
import com.portfolio.extension.exception.InvalidIpException;
import com.portfolio.extension.net.IpCidr;
import com.portfolio.extension.observability.IpMetrics;
import com.portfolio.extension.service.IpAccessRuleService;
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
 * 검색 파라미터의 시각은 애매함을 피하려 epoch millis(long)로 받는다(프론트가 디바이스 TZ 로 계산).
 */
@Tag(name = "IP 접근 규칙", description = "허용 IP/CIDR·사용 시간대 등록·수정·삭제·검색, 포함(containment) 조회, 변경 감사")
@RestController
@RequestMapping("/api/ip-rules")
public class IpAccessRuleController {

    private final IpAccessRuleService service;
    private final IpAuditService auditService;
    private final IpMetrics metrics;

    public IpAccessRuleController(IpAccessRuleService service, IpAuditService auditService,
            IpMetrics metrics) {
        this.service = service;
        this.auditService = auditService;
        this.metrics = metrics;
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

    /** 변경 감사 로그(누가/언제/무엇). 규칙 목록과 동일한 키셋 페이지네이션을 재사용한다. */
    @GetMapping("/audit")
    public IpAuditListResponse audit(
            @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "30") int size) {
        return auditService.list(cursor, size);
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

    private static IpCidr parseOr400(String value, String label) {
        try {
            return IpCidr.parse(value);
        } catch (IllegalArgumentException e) {
            throw new InvalidIpException(label + " 값이 올바르지 않습니다: " + e.getMessage());
        }
    }
}

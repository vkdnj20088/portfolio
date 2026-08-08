package com.portfolio.extension.exception;

import com.portfolio.extension.config.CorrelationIdFilter;
import java.net.URI;
import java.util.Locale;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.support.MissingServletRequestPartException;

/**
 * 예외 -> HTTP 상태 매핑을 한 곳에서 일원화한다.
 * 컨트롤러/서비스는 도메인 예외만 던지고, 상태코드 정책은 여기서 관리한다.
 *
 * <h2>왜 RFC 7807 인가</h2>
 * 직전까지 응답은 {@code {code, message}} 라는 자체 형태였다. 동작에는 문제가 없었지만
 * <b>에러는 API 계약의 일부</b>인데 성공 응답만 스키마가 있고 실패 응답은 소비자가 매번
 * 손으로 읽어야 했다(실제로 이 저장소의 세 백엔드 - Spring, 챗/문서QA 라우트 핸들러 -
 * 가 서로 다른 형태를 내고 있었다: 여기는 JSON 객체, 나머지는 평문).
 *
 * <p>{@link ProblemDetail}(RFC 7807 / RFC 9457)로 옮기면 세 가지를 얻는다.
 * <ol>
 *   <li>소비자가 파서를 한 번만 쓴다 - 프론트는 {@code parseProblem()} 하나를 공유한다.</li>
 *   <li>표준을 아는 사람이 문서 없이 이해한다({@code type/title/status/detail/instance}).</li>
 *   <li>springdoc 이 에러 스키마까지 문서화한다 - 계약이 코드에서 스펙으로 이어진다.</li>
 * </ol>
 *
 * <h2>확장 필드 두 개</h2>
 * <ul>
 *   <li>{@code code} - 도메인 에러 코드. RFC 7807 에 없지만 프론트 분기의 근거가 되는 값이라
 *       {@code detail}(사람이 읽는 문장)과 분리해 유지한다. 문장은 바뀌어도 코드는 안 바뀐다.</li>
 *   <li>{@code cid} - 요청 상관 id. {@link CorrelationIdFilter} 가 이미 MDC 에 심어 모든 로그에
 *       실리는 값을 <b>응답 본문에도 노출</b>한다. 사용자가 화면에서 본 id 하나로 서버 로그를
 *       바로 찾을 수 있다 - 관측성이 이미 있으니 그것을 계약에 드러내는 것이 다음 수다.</li>
 * </ul>
 *
 * <p>{@code type} 은 URN 을 쓴다. RFC 는 역참조 가능한 URI 를 권하지만, 문서 페이지를 실제로
 * 서빙하지 않는 상태에서 http URL 을 적으면 <b>죽은 링크를 계약에 박는 것</b>이다. URN 은
 * 안정된 식별자 역할만 하고 그런 약속을 하지 않는다.
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    /** {@code urn:problem:invalid} 처럼 코드에서 파생한 안정 식별자. */
    private static final String TYPE_PREFIX = "urn:problem:";

    private static ProblemDetail problem(HttpStatus status, String code, String title, String detail) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(status, detail);
        pd.setTitle(title);
        pd.setType(URI.create(TYPE_PREFIX + code.toLowerCase(Locale.ROOT).replace('_', '-')));
        pd.setProperty("code", code);
        // 요청 경로(instance). 핸들러 14개에 HttpServletRequest 파라미터를 늘리지 않고
        // 요청 컨텍스트에서 꺼낸다 - 비동기 경로에서는 없을 수 있어 null 을 허용한다.
        if (RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attrs) {
            pd.setInstance(URI.create(attrs.getRequest().getRequestURI()));
        }
        String cid = MDC.get(CorrelationIdFilter.MDC_KEY);
        if (cid != null) {
            pd.setProperty("cid", cid);
        }
        return pd;
    }

    @ExceptionHandler(InvalidExtensionException.class)
    public ProblemDetail handleInvalid(InvalidExtensionException e) {
        return problem(HttpStatus.BAD_REQUEST, "INVALID", "잘못된 요청", e.getMessage());
    }

    @ExceptionHandler(ExtensionNotFoundException.class)
    public ProblemDetail handleNotFound(ExtensionNotFoundException e) {
        return problem(HttpStatus.NOT_FOUND, "NOT_FOUND", "대상을 찾을 수 없음", e.getMessage());
    }

    @ExceptionHandler(IpRuleNotFoundException.class)
    public ProblemDetail handleIpRuleNotFound(IpRuleNotFoundException e) {
        return problem(HttpStatus.NOT_FOUND, "NOT_FOUND", "대상을 찾을 수 없음", e.getMessage());
    }

    @ExceptionHandler(RelayJobNotFoundException.class)
    public ProblemDetail handleRelayJobNotFound(RelayJobNotFoundException e) {
        return problem(HttpStatus.NOT_FOUND, "NOT_FOUND", "대상을 찾을 수 없음", e.getMessage());
    }

    @ExceptionHandler(RelayIllegalTransitionException.class)
    public ProblemDetail handleRelayIllegalTransition(RelayIllegalTransitionException e) {
        // 클라이언트가 보던 상태가 낡았다는 뜻 - 화면은 코드로 문구를 조립하고 목록을 새로고침한다.
        return problem(HttpStatus.CONFLICT, "ILLEGAL_TRANSITION", "허용되지 않는 상태 전이", e.getMessage());
    }

    @ExceptionHandler(InvalidIpException.class)
    public ProblemDetail handleInvalidIp(InvalidIpException e) {
        return problem(HttpStatus.BAD_REQUEST, "INVALID", "잘못된 IP/CIDR", e.getMessage());
    }

    @ExceptionHandler(DuplicateExtensionException.class)
    public ProblemDetail handleDuplicate(DuplicateExtensionException e) {
        return problem(HttpStatus.CONFLICT, "DUPLICATE", "이미 존재함", e.getMessage());
    }

    /** 422 (RFC 9110: 구 UNPROCESSABLE_ENTITY) */
    @ExceptionHandler(ExtensionLimitExceededException.class)
    public ProblemDetail handleLimit(ExtensionLimitExceededException e) {
        return problem(HttpStatus.UNPROCESSABLE_CONTENT, "LIMIT_EXCEEDED", "허용 개수 초과", e.getMessage());
    }

    /**
     * 파싱/검증 용량 초과 - 동시 파싱 상한(벌크헤드)이나 파싱 타임아웃에 걸린 경우.
     *
     * <p>이 핸들러만 {@link ResponseEntity} 를 돌려주는 이유는 <b>{@code Retry-After} 헤더</b>가
     * 필요하기 때문이다. 본문 확장 필드({@code retryAfterSeconds})는 우리 프론트만 읽지만,
     * {@code Retry-After} 는 RFC 9110 표준 헤더라 우리 코드를 모르는 클라이언트(프록시, 재시도
     * 라이브러리, curl 을 쓰는 사람)도 해석한다. 같은 값을 두 곳에 싣는 것은 중복이 아니라
     * 대상이 다르다 - 헤더는 규약이고 본문은 화면 문구를 만드는 재료다.
     */
    @ExceptionHandler(ValidationCapacityException.class)
    public ResponseEntity<ProblemDetail> handleCapacity(ValidationCapacityException e) {
        ProblemDetail pd = problem(HttpStatus.SERVICE_UNAVAILABLE, "CAPACITY", "검증 용량 초과", e.getMessage());
        pd.setProperty("retryAfterSeconds", e.getRetryAfterSeconds());
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .header(HttpHeaders.RETRY_AFTER, String.valueOf(e.getRetryAfterSeconds()))
                .body(pd);
    }

    /** 400 - 예: 숫자 id 자리에 문자 */
    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    public ProblemDetail handleTypeMismatch(MethodArgumentTypeMismatchException e) {
        return problem(HttpStatus.BAD_REQUEST, "INVALID", "잘못된 요청",
                "요청 파라미터 형식이 올바르지 않습니다: " + e.getName());
    }

    /** 400 - @Valid DTO 제약 위반(빈 값/길이) */
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ProblemDetail handleBeanValidation(MethodArgumentNotValidException e) {
        // 첫 필드 에러 메시지를 detail 로 전달(도메인 검증과 같은 형태 유지).
        FieldError first = e.getBindingResult().getFieldError();
        String detail = (first != null && first.getDefaultMessage() != null)
                ? first.getDefaultMessage()
                : "요청 값이 올바르지 않습니다.";
        ProblemDetail pd = problem(HttpStatus.BAD_REQUEST, "INVALID", "잘못된 요청", detail);
        if (first != null) {
            pd.setProperty("field", first.getField());
        }
        return pd;
    }

    /** 409 - @Version 충돌(동시 토글 로스트 업데이트 차단) */
    @ExceptionHandler(OptimisticLockingFailureException.class)
    public ProblemDetail handleOptimisticLock(OptimisticLockingFailureException e) {
        return problem(HttpStatus.CONFLICT, "CONFLICT", "동시 수정 충돌",
                "다른 요청이 먼저 상태를 변경했습니다. 새로고침 후 다시 시도해 주세요.");
    }

    /** 413 (RFC 9110: 구 PAYLOAD_TOO_LARGE) */
    @ExceptionHandler(MaxUploadSizeExceededException.class)
    public ProblemDetail handleUploadSize(MaxUploadSizeExceededException e) {
        return problem(HttpStatus.CONTENT_TOO_LARGE, "PAYLOAD_TOO_LARGE", "업로드 크기 초과",
                "업로드 가능한 파일 크기를 초과했습니다.");
    }

    /** 400 - 잘못됐거나 비어 있는 JSON 본문 */
    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ProblemDetail handleUnreadable(HttpMessageNotReadableException e) {
        return problem(HttpStatus.BAD_REQUEST, "INVALID", "본문 해석 실패",
                "요청 본문을 해석할 수 없습니다. JSON 형식을 확인해 주세요.");
    }

    /** 400 - 멀티파트 필수 파트 누락(예: file) */
    @ExceptionHandler(MissingServletRequestPartException.class)
    public ProblemDetail handleMissingPart(MissingServletRequestPartException e) {
        return problem(HttpStatus.BAD_REQUEST, "INVALID", "필수 항목 누락",
                "필수 요청 항목이 없습니다: " + e.getRequestPartName());
    }

    /** 400 - 필수 요청 파라미터 누락 */
    @ExceptionHandler(MissingServletRequestParameterException.class)
    public ProblemDetail handleMissingParam(MissingServletRequestParameterException e) {
        return problem(HttpStatus.BAD_REQUEST, "INVALID", "필수 항목 누락",
                "필수 요청 항목이 없습니다: " + e.getParameterName());
    }

    /**
     * 마지막 방어선. 위에서 잡지 못한 예외를 같은 problem+json 형태로 수렴시켜 계약을 총체화한다.
     *
     * <p>Spring MVC 프레임워크 예외(정적 리소스 404, 405, 406, 415 등)는 이미 자체 상태코드를
     * 가지므로({@link org.springframework.web.ErrorResponse}) 그 상태는 존중하되 응답 형태만 통일한다
     * (404 가 500 으로 뒤바뀌지 않도록). 상태를 갖지 않는 진짜 예기치 못한 예외만 500 으로
     * 수렴시키고, 원인은 ERROR 로그로 남기되 내부 메시지는 응답에 노출하지 않는다(정보 누출 방지).
     */
    @ExceptionHandler(Exception.class)
    public ProblemDetail handleUnexpected(Exception e) {
        if (e instanceof org.springframework.web.ErrorResponse framework) {
            HttpStatusCode status = framework.getStatusCode();
            return problem(HttpStatus.valueOf(status.value()), "REQUEST_ERROR", "요청 처리 실패",
                    "요청을 처리할 수 없습니다.");
        }
        log.error("unhandled exception", e);
        return problem(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL", "서버 내부 오류",
                "서버 내부 오류가 발생했습니다.");
    }
}

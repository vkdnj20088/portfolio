package com.portfolio.extension.exception;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.support.MissingServletRequestPartException;

/**
 * 예외 -> HTTP 상태 매핑을 한 곳에서 일원화한다.
 * 컨트롤러/서비스는 도메인 예외만 던지고, 상태코드 정책은 여기서 관리한다.
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    public record ErrorResponse(String code, String message) {
    }

    @ExceptionHandler(InvalidExtensionException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST) // 400
    public ErrorResponse handleInvalid(InvalidExtensionException e) {
        return new ErrorResponse("INVALID", e.getMessage());
    }

    @ExceptionHandler(ExtensionNotFoundException.class)
    @ResponseStatus(HttpStatus.NOT_FOUND) // 404
    public ErrorResponse handleNotFound(ExtensionNotFoundException e) {
        return new ErrorResponse("NOT_FOUND", e.getMessage());
    }

    @ExceptionHandler(IpRuleNotFoundException.class)
    @ResponseStatus(HttpStatus.NOT_FOUND) // 404 - 존재하지 않는 IP 접근 규칙
    public ErrorResponse handleIpRuleNotFound(IpRuleNotFoundException e) {
        return new ErrorResponse("NOT_FOUND", e.getMessage());
    }

    @ExceptionHandler(InvalidIpException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST) // 400 - 잘못된 IP/CIDR(match 조회 등 직접 파싱 지점)
    public ErrorResponse handleInvalidIp(InvalidIpException e) {
        return new ErrorResponse("INVALID", e.getMessage());
    }

    @ExceptionHandler(DuplicateExtensionException.class)
    @ResponseStatus(HttpStatus.CONFLICT) // 409
    public ErrorResponse handleDuplicate(DuplicateExtensionException e) {
        return new ErrorResponse("DUPLICATE", e.getMessage());
    }

    @ExceptionHandler(ExtensionLimitExceededException.class)
    @ResponseStatus(HttpStatus.UNPROCESSABLE_CONTENT) // 422 (RFC 9110: 구 UNPROCESSABLE_ENTITY)
    public ErrorResponse handleLimit(ExtensionLimitExceededException e) {
        return new ErrorResponse("LIMIT_EXCEEDED", e.getMessage());
    }

    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST) // 400 - 예: 숫자 id 자리에 문자
    public ErrorResponse handleTypeMismatch(MethodArgumentTypeMismatchException e) {
        return new ErrorResponse("INVALID", "요청 파라미터 형식이 올바르지 않습니다: " + e.getName());
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST) // 400 - @Valid DTO 제약 위반(빈 값/길이)
    public ErrorResponse handleBeanValidation(MethodArgumentNotValidException e) {
        // 첫 필드 에러 메시지를 사용자에게 전달(서비스 도메인 검증과 동일한 {code,message} 형태 유지)
        FieldError first = e.getBindingResult().getFieldError();
        String message = (first != null && first.getDefaultMessage() != null)
                ? first.getDefaultMessage()
                : "요청 값이 올바르지 않습니다.";
        return new ErrorResponse("INVALID", message);
    }

    @ExceptionHandler(OptimisticLockingFailureException.class)
    @ResponseStatus(HttpStatus.CONFLICT) // 409 - @Version 충돌(동시 토글 로스트 업데이트 차단)
    public ErrorResponse handleOptimisticLock(OptimisticLockingFailureException e) {
        return new ErrorResponse("CONFLICT",
                "다른 요청이 먼저 상태를 변경했습니다. 새로고침 후 다시 시도해 주세요.");
    }

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    @ResponseStatus(HttpStatus.CONTENT_TOO_LARGE) // 413 (RFC 9110: 구 PAYLOAD_TOO_LARGE)
    public ErrorResponse handleUploadSize(MaxUploadSizeExceededException e) {
        return new ErrorResponse("PAYLOAD_TOO_LARGE", "업로드 가능한 파일 크기를 초과했습니다.");
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST) // 400 - 잘못됐거나 비어 있는 JSON 본문
    public ErrorResponse handleUnreadable(HttpMessageNotReadableException e) {
        return new ErrorResponse("INVALID", "요청 본문을 해석할 수 없습니다. JSON 형식을 확인해 주세요.");
    }

    @ExceptionHandler(MissingServletRequestPartException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST) // 400 - 멀티파트 필수 파트 누락(예: file)
    public ErrorResponse handleMissingPart(MissingServletRequestPartException e) {
        return new ErrorResponse("INVALID", "필수 요청 항목이 없습니다: " + e.getRequestPartName());
    }

    @ExceptionHandler(MissingServletRequestParameterException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST) // 400 - 필수 요청 파라미터 누락
    public ErrorResponse handleMissingParam(MissingServletRequestParameterException e) {
        return new ErrorResponse("INVALID", "필수 요청 항목이 없습니다: " + e.getParameterName());
    }

    /**
     * 마지막 방어선. 위에서 잡지 못한 예외를 {@code {code,message}} 형태로 수렴시켜 계약을 총체화한다.
     *
     * <p>Spring MVC 프레임워크 예외(정적 리소스 404, 405, 406, 415 등)는 이미 자체 상태코드를
     * 가지므로({@link org.springframework.web.ErrorResponse}) 그 상태는 존중하되 응답 형태만 통일한다
     * (404 가 500 으로 뒤바뀌지 않도록). 상태를 갖지 않는 진짜 예기치 못한 예외만 500 으로
     * 수렴시키고, 원인은 ERROR 로그로 남기되 내부 메시지는 응답에 노출하지 않는다(정보 누출 방지).
     */
    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> handleUnexpected(Exception e) {
        if (e instanceof org.springframework.web.ErrorResponse framework) {
            HttpStatusCode status = framework.getStatusCode();
            return ResponseEntity.status(status)
                    .body(new ErrorResponse("REQUEST_ERROR", "요청을 처리할 수 없습니다."));
        }
        log.error("unhandled exception", e);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(new ErrorResponse("INTERNAL", "서버 내부 오류가 발생했습니다."));
    }
}

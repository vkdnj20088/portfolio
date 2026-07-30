package com.portfolio.extension.exception;

/**
 * 파일 콘텐츠 검증이 <b>용량 한도</b>에 걸렸음을 알린다. GlobalExceptionHandler 가 503(CAPACITY)로
 * 매핑하고 {@code retryAfterSeconds} 를 problem+json 에 실어 준다.
 *
 * <p>왜 이 예외가 필요한가: Tika 콘텐츠 판별은 CPU 바운드이고, 중첩 컨테이너·압축폭탄에서
 * 시간과 메모리를 함께 먹는다. 동시 파싱을 제한하지 않으면 업로드 몇 건이 단일 인스턴스의
 * 워커 스레드를 전부 붙잡아 <b>다른 기능까지 함께 멈춘다</b>(IP 조회, 목록 등).
 * 그래서 파싱을 전용 풀로 격리하고(벌크헤드) 상한을 넘으면 <b>기다리지 않고 빠르게 거절</b>한다 -
 * 느리게 성공하는 것보다 빠르게 거절하는 편이 호출자에게 낫고, 시스템 전체를 지킨다.
 *
 * <p>404/400 과 달리 이 실패는 <b>재시도하면 성공할 수 있는</b> 종류다. 그 차이를 상태코드(503)와
 * 재시도 힌트로 표현한다 - 클라이언트가 영구 실패와 일시 실패를 구분할 수 있어야 한다.
 */
public class ValidationCapacityException extends RuntimeException {

    private final int retryAfterSeconds;

    public ValidationCapacityException(String message, int retryAfterSeconds) {
        super(message);
        this.retryAfterSeconds = retryAfterSeconds;
    }

    public int getRetryAfterSeconds() {
        return retryAfterSeconds;
    }
}

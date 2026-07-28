package com.portfolio.extension.lock;

import java.util.function.Supplier;

/**
 * 임계 구역을 직렬화하는 락 추상화. 구현을 프로퍼티({@code app.distributed-lock.provider})로 교체한다.
 *
 * <p>커스텀 확장자 추가의 "개수 확인 -> 삽입"(TOCTOU) 구간처럼, 확인과 쓰기 사이에 다른 요청이
 * 끼어들면 불변식(최대 200개)이 깨진다. 이 인터페이스 뒤에서 배포 형상에 맞는 락 전략을 고른다:
 *
 * <ul>
 *   <li>{@code in-process}(기본): {@link InProcessDistributedLock} - 키별 {@link java.util.concurrent.locks.ReentrantLock}.
 *       단일 JVM 에서만 유효하다. 로컬/데모/단일 인스턴스 배포용.</li>
 *   <li>{@code mysql}: {@link MySqlNamedLock} - MySQL {@code GET_LOCK}/{@code RELEASE_LOCK}.
 *       공유 DB 를 쓰는 다중 인스턴스에서 클러스터 전역으로 직렬화한다(추가 인프라 불필요).</li>
 *   <li>{@code redis}: {@link RedissonDistributedLock} - Redisson {@code RLock}(선택적, 아래 주석 참조).</li>
 * </ul>
 *
 * <p>어느 전략이든 {@code custom_extension.name UNIQUE} 제약이 최후의 방어선으로 남아, 락 밖(예:
 * 락 획득 실패 후)에서 동시 삽입이 일어나도 중복은 DB 가 막는다. 락은 "초과 방지",
 * UNIQUE 는 "중복 방지"로 역할이 갈린다.
 *
 * @implNote {@code action} 실행 중 예외가 나도 반드시 락을 해제해야 한다(각 구현의 finally).
 */
public interface DistributedLock {

    /**
     * {@code key} 로 식별되는 임계 구역을 (전략의 범위 안에서) 직렬화하여 {@code action} 을 실행하고
     * 그 결과를 반환한다. 락 획득에 실패하면 구현이 예외를 던진다.
     */
    <T> T executeWithLock(String key, Supplier<T> action);
}

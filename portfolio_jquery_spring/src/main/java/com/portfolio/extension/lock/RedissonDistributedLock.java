package com.portfolio.extension.lock;

import org.redisson.api.RLock;
import org.redisson.api.RedissonClient;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;

/**
 * Redisson {@code RLock} 기반 분산 락({@code provider=redis}). 다중 인스턴스 + Redis 환경에서
 * 대기가 DB 커넥션을 잡지 않는(=팬인이 커도 커넥션 풀을 갉지 않는) 전략이다.
 *
 * <p><b>선택적 통합</b>: Redisson 은 {@code compileOnly} 의존이라 기본 산출물(bootJar)에는 포함되지
 * 않는다 - 이 클래스가 실제 Redisson API 로 올바르게 컴파일됨은 보장하되, 쓰지 않는 배포에 netty
 * 등 무거운 전이 의존을 싣지 않기 위함이다. redis 프로바이더를 실제로 켜려면 (1) 런타임 클래스패스에
 * {@code org.redisson:redisson} 을 추가하고 (2) {@code app.distributed-lock.provider=redis} +
 * {@code app.distributed-lock.redis.address} 를 설정한다. {@link ConditionalOnClass} 가 런타임에
 * Redisson 부재를 ASM 으로 감지해(클래스 로딩 없이) 이 빈을 조용히 건너뛰므로, 미설정 배포에서
 * {@code NoClassDefFoundError} 가 나지 않는다.
 *
 * <p>{@code tryLock(wait, lease, unit)} 의 lease(자동 만료)는 임계 구역을 쥔 인스턴스가 죽어도 락이
 * 영원히 걸려 있지 않게 하는 안전장치다. lease 안에 작업이 끝나야 하므로 넉넉히 잡는다.
 */
@Component
@ConditionalOnClass(name = "org.redisson.api.RedissonClient")
@ConditionalOnProperty(name = "app.distributed-lock.provider", havingValue = "redis")
public class RedissonDistributedLock implements DistributedLock {

    private final RedissonClient redissonClient;
    private final long waitSeconds;
    private final long leaseSeconds;

    public RedissonDistributedLock(RedissonClient redissonClient,
                                   @Value("${app.distributed-lock.timeout-seconds:10}") long waitSeconds,
                                   @Value("${app.distributed-lock.redis.lease-seconds:30}") long leaseSeconds) {
        this.redissonClient = redissonClient;
        this.waitSeconds = waitSeconds;
        this.leaseSeconds = leaseSeconds;
    }

    @Override
    public <T> T executeWithLock(String key, Supplier<T> action) {
        RLock lock = redissonClient.getLock(key);
        boolean acquired;
        try {
            acquired = lock.tryLock(waitSeconds, leaseSeconds, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("분산 락 대기 중 인터럽트: key=" + key, e);
        }
        if (!acquired) {
            throw new IllegalStateException("분산 락 획득 실패(wait=" + waitSeconds + "s): key=" + key);
        }
        try {
            return action.get();
        } finally {
            // 이 스레드가 쥔 경우에만 해제한다(lease 만료로 이미 풀렸을 수 있다).
            if (lock.isHeldByCurrentThread()) {
                lock.unlock();
            }
        }
    }
}

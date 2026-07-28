package com.portfolio.extension.lock;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.Supplier;

/**
 * 단일 JVM 락(기본 전략). 키마다 {@link ReentrantLock} 을 두어 서로 다른 키는 병렬로 진행시킨다.
 *
 * <p>프로퍼티가 없거나 {@code in-process} 일 때 활성화된다({@code matchIfMissing}). 로컬/데모/단일
 * 인스턴스에서 충분하고, 다중 인스턴스로 확장하면 {@code app.distributed-lock.provider=mysql}(또는
 * {@code redis})로 바꾸면 소비 코드({@code CustomExtensionService})는 그대로 둔 채 전략만 교체된다.
 */
@Component
@ConditionalOnProperty(name = "app.distributed-lock.provider", havingValue = "in-process", matchIfMissing = true)
public class InProcessDistributedLock implements DistributedLock {

    /** 키별 락. computeIfAbsent 로 최초 1회만 생성한다. 키 집합은 유한(락 이름 상수)하라 누수 없다. */
    private final ConcurrentMap<String, ReentrantLock> locks = new ConcurrentHashMap<>();

    @Override
    public <T> T executeWithLock(String key, Supplier<T> action) {
        ReentrantLock lock = locks.computeIfAbsent(key, k -> new ReentrantLock());
        lock.lock();
        try {
            return action.get();
        } finally {
            lock.unlock();
        }
    }
}

package com.portfolio.extension.lock;

import org.redisson.Redisson;
import org.redisson.api.RedissonClient;
import org.redisson.config.Config;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * redis 프로바이더가 켜졌고 런타임에 Redisson 이 있을 때만 {@link RedissonClient} 를 만든다.
 *
 * <p>{@link ConditionalOnClass}(문자열 형태)로 Redisson 부재 시 ASM 단계에서 이 설정을 건너뛰어,
 * {@code compileOnly} 로 런타임에 Redisson 이 없는 기본 배포에서도 안전하다. 실제 Redis 접속 정보는
 * {@code app.distributed-lock.redis.address}({@code redis://host:port})로 주입한다.
 */
@Configuration
@ConditionalOnClass(name = "org.redisson.api.RedissonClient")
@ConditionalOnProperty(name = "app.distributed-lock.provider", havingValue = "redis")
public class RedissonLockConfig {

    @Bean(destroyMethod = "shutdown")
    @ConditionalOnMissingBean
    public RedissonClient redissonClient(
            @Value("${app.distributed-lock.redis.address:redis://127.0.0.1:6379}") String address) {
        Config config = new Config();
        config.useSingleServer().setAddress(address);
        return Redisson.create(config);
    }
}

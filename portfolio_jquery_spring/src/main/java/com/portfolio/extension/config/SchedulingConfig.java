package com.portfolio.extension.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * 스케줄링 활성화 - 릴레이 워커/아웃박스 발행기의 @Scheduled 를 켠다.
 * 테스트에서 백그라운드 동작을 끄려면 {@code app.relay.worker.enabled=false} 를 쓴다
 * (스케줄러는 돌되 틱이 즉시 반환 - 컨텍스트 구성 차이를 만들지 않는 가장 작은 스위치).
 */
@Configuration
@EnableScheduling
public class SchedulingConfig {
}

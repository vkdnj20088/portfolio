package com.portfolio.extension.service;

import com.portfolio.extension.domain.RelayOutboxEvent;
import com.portfolio.extension.repository.RelayOutboxRepository;
import java.time.Instant;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 아웃박스 발행기 - <b>커밋된</b> 미발행 이벤트를 뒤따라 발행한다. 원본 트랜잭션이 구르면
 * 이벤트 행 자체가 없으므로 발행할 것도 없다 - 이 시차(커밋 후 발행)가 아웃박스의 본질이다.
 *
 * <p>실제 브로커는 없다(§0 - 외부 호출 없음). "발행" = published_at 스탬프이고, 화면은
 * 미발행 잔량이 줄어드는 것으로 발행기를 관찰한다. 브로커를 붙인다면 이 컴포넌트가 유일한
 * 교체 지점이다(at-least-once: 스탬프 전에 죽으면 재발행 - 소비자 멱등이 전제).
 */
@Component
public class RelayOutboxPublisher {

    private static final Logger log = LoggerFactory.getLogger(RelayOutboxPublisher.class);
    static final int PUBLISH_BATCH = 100;

    private final RelayOutboxRepository outbox;
    private final TransactionTemplate tx;
    private final boolean enabled;

    public RelayOutboxPublisher(RelayOutboxRepository outbox,
            PlatformTransactionManager transactionManager,
            @Value("${app.relay.worker.enabled:true}") boolean enabled) {
        this.outbox = outbox;
        this.tx = new TransactionTemplate(transactionManager);
        this.enabled = enabled;
    }

    @Scheduled(fixedDelayString = "${app.relay.publisher.tick-ms:1000}")
    public void publishPending() {
        if (!enabled) {
            return;
        }
        Integer published = tx.execute(status -> {
            List<RelayOutboxEvent> pending = outbox.findUnpublished(PUBLISH_BATCH);
            Instant now = Instant.now();
            pending.forEach(e -> e.markPublished(now));
            return pending.size();
        });
        if (published != null && published > 0) {
            log.info("relay outbox published: {} event(s)", published);
        }
    }
}

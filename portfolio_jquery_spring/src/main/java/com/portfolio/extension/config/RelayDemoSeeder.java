package com.portfolio.extension.config;

import com.portfolio.extension.relay.RelayJobType;
import com.portfolio.extension.relay.RelayPublishMode;
import com.portfolio.extension.relay.RelayScenario;
import com.portfolio.extension.repository.RelayJobRepository;
import com.portfolio.extension.service.RelayJobService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/**
 * 릴레이 데모 표본 - 빈 화면이면 평가자의 30초가 버튼 찾는 데 쓰인다. 기존 데모들이 표본을
 * 깔아 두는 전례를 따르되, 완성된 결과를 INSERT 하는 것이 아니라 <b>실제 파이프라인에
 * 예약해 워커가 진짜로 돌게 한다</b>. 시드가 고정이라 몇 초 뒤 화면에 도착하는 타임라인은
 * 언제나 같다 - 표본조차 결정적 재현이다.
 *
 * <p>이미 작업이 있으면(재기동한 prod) 건너뛴다. H2(create-drop)는 기동마다 비어 있으므로
 * 로컬은 항상 신선한 표본으로 시작한다.
 */
@Component
public class RelayDemoSeeder {

    private static final Logger log = LoggerFactory.getLogger(RelayDemoSeeder.class);

    private final RelayJobRepository jobs;
    private final RelayJobService service;
    private final boolean enabled;

    public RelayDemoSeeder(RelayJobRepository jobs, RelayJobService service,
            @Value("${app.relay.seed.enabled:true}") boolean enabled) {
        this.jobs = jobs;
        this.service = service;
        this.enabled = enabled;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void seed() {
        if (!enabled || jobs.count() > 0) {
            return;
        }
        // 시나리오별 표본 - 30초 명제의 세 증거(실패가 일어난다 / 재개된다 / 포기 지점이 있다).
        enqueue("sample-pay-8f2a", RelayJobType.PAYMENT_NOTIFY, "주문 8f2a 승인 통보", RelayScenario.THIRD_TIME_LUCKY);
        enqueue("sample-mail-3c91", RelayJobType.RECEIPT_EMAIL, "영수증 3c91 발송", RelayScenario.ALWAYS_SUCCEED);
        enqueue("sample-hook-77b0", RelayJobType.WEBHOOK_PUSH, "파트너 웹훅 77b0", RelayScenario.ALWAYS_FAIL);
        enqueue("sample-idx-1d44", RelayJobType.SEARCH_INDEX_SYNC, "색인 동기화 1d44", RelayScenario.TIMEOUT_THEN_SUCCEED);
        enqueue("sample-pay-b2e7", RelayJobType.PAYMENT_NOTIFY, "주문 b2e7 승인 통보", RelayScenario.FLAKY_5XX);
        enqueue("sample-hook-90ac", RelayJobType.WEBHOOK_PUSH, "파트너 웹훅 90ac", RelayScenario.ALWAYS_FAIL);
        log.info("relay demo sample seeded: 6 jobs (워커가 몇 초 안에 타임라인을 채운다)");
    }

    private void enqueue(String key, RelayJobType type, String payload, RelayScenario scenario) {
        // 시드를 키에서 파생(컨트롤러 기본과 같은 규칙) - 표본 타임라인이 기동마다 같다.
        service.enqueue(key, type, payload, scenario,
                com.portfolio.extension.relay.Mulberry32.hashSeed(key), 3,
                RelayPublishMode.OUTBOX, false);
    }
}

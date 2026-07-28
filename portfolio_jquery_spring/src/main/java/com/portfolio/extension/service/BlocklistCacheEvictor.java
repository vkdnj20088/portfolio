package com.portfolio.extension.service;

import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * 차단 목록 변경 이벤트를 받아 캐시를 무효화한다.
 *
 * <p>핵심은 타이밍이다. {@code AFTER_COMMIT} 로 커밋이 끝난 뒤에만 무효화한다. 무효화가
 * 커밋 전에 일어나면(쓰기 메서드에 얹은 {@code @CacheEvict} 의 어드바이저 순서가 트랜잭션보다
 * 안쪽일 때 발생할 수 있다) 동시 요청의 {@link BlockedExtensionProvider#current()} 가
 * 커밋 전 스냅샷으로 캐시를 다시 채워 변경이 유실된다. 보안 차단 목록에서는 이 창이 곧
 * "차단이 걸려야 하는데 안 걸리는 순간"이 되므로 커밋 후 무효화를 강제한다.
 *
 * <p>별도 빈으로 두는 이유: {@link BlockedExtensionProvider#invalidate()} 는 {@code @CacheEvict}
 * 프록시 메서드라 같은 빈 안에서 자기호출하면 프록시를 우회해 무효화가 일어나지 않는다.
 * 여기서 주입받은 인스턴스로 호출하면 프록시를 통한 외부 호출이 되어 정상 적용된다.
 */
@Component
public class BlocklistCacheEvictor {

    private final BlockedExtensionProvider blockedExtensionProvider;

    public BlocklistCacheEvictor(BlockedExtensionProvider blockedExtensionProvider) {
        this.blockedExtensionProvider = blockedExtensionProvider;
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onBlocklistChanged(BlocklistChangedEvent event) {
        blockedExtensionProvider.invalidate();
    }
}

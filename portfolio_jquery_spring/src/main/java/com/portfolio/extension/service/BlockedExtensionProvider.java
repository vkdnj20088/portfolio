package com.portfolio.extension.service;

import com.portfolio.extension.repository.CustomExtensionRepository;
import com.portfolio.extension.repository.FixedExtensionRepository;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.HashSet;
import java.util.Set;

/**
 * 현재 차단 대상 확장자 집합(고정 blocked=true ∪ 커스텀 전체)을 제공하고 캐싱한다.
 *
 * 파일 검증은 요청마다 이 집합이 필요하지만 목록은 자주 바뀌지 않는다. 매 요청 DB 조회(findAllx2)를
 * 피하기 위해 캐싱하고, 목록 변경(추가/삭제/토글) 시 {@link #invalidate()} 또는 각 서비스의
 * {@code @CacheEvict} 로 무효화한다.
 */
@Component
public class BlockedExtensionProvider {

    static final String CACHE = "blockedExtensions";

    private final FixedExtensionRepository fixedExtensionRepository;
    private final CustomExtensionRepository customExtensionRepository;

    public BlockedExtensionProvider(FixedExtensionRepository fixedExtensionRepository,
                                    CustomExtensionRepository customExtensionRepository) {
        this.fixedExtensionRepository = fixedExtensionRepository;
        this.customExtensionRepository = customExtensionRepository;
    }

    @Cacheable(CACHE)
    @Transactional(readOnly = true)
    public Set<String> current() {
        Set<String> blocked = new HashSet<>();
        fixedExtensionRepository.findAll().stream()
                .filter(f -> f.isBlocked())
                .forEach(f -> blocked.add(f.getName()));
        customExtensionRepository.findAll()
                .forEach(c -> blocked.add(c.getName()));
        // 반환값은 캐시에 저장되어 모든 요청이 같은 인스턴스를 공유한다 - 호출자의 변조가
        // 캐시를 오염시키지 않도록(보안 차단 목록이다) 불변 사본으로 돌려준다.
        return Set.copyOf(blocked);
    }

    /** 차단 목록 변경 시 캐시 무효화. */
    @CacheEvict(value = CACHE, allEntries = true)
    public void invalidate() {
        // 캐시 무효화 트리거 전용
    }
}

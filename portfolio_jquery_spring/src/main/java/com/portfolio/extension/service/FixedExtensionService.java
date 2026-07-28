package com.portfolio.extension.service;

import com.portfolio.extension.domain.FixedExtension;
import com.portfolio.extension.dto.FixedExtensionResponse;
import com.portfolio.extension.exception.ExtensionNotFoundException;
import com.portfolio.extension.repository.FixedExtensionRepository;
import com.portfolio.extension.util.ExtensionNormalizer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class FixedExtensionService {

    private static final Logger log = LoggerFactory.getLogger(FixedExtensionService.class);

    private final FixedExtensionRepository fixedExtensionRepository;
    private final ExtensionNormalizer normalizer;
    private final ApplicationEventPublisher eventPublisher;

    public FixedExtensionService(FixedExtensionRepository fixedExtensionRepository,
                                 ExtensionNormalizer normalizer,
                                 ApplicationEventPublisher eventPublisher) {
        this.fixedExtensionRepository = fixedExtensionRepository;
        this.normalizer = normalizer;
        this.eventPublisher = eventPublisher;
    }

    @Transactional(readOnly = true)
    public List<FixedExtensionResponse> list() {
        return fixedExtensionRepository.findAll(Sort.by(Sort.Direction.ASC, "id")).stream()
                .map(f -> new FixedExtensionResponse(f.getName(), f.isBlocked()))
                .toList();
    }

    @Transactional
    public FixedExtensionResponse toggle(String name, boolean blocked) {
        String normalized = normalizer.normalize(name); // 대소문자/점 변형 허용(커스텀과 정책 일관)
        FixedExtension fixed = fixedExtensionRepository.findByName(normalized)
                .orElseThrow(() -> new ExtensionNotFoundException("고정 확장자를 찾을 수 없습니다: " + name));
        fixed.changeBlocked(blocked);
        eventPublisher.publishEvent(new BlocklistChangedEvent()); // 커밋 후 캐시 무효화
        log.info("fixed extension toggled: name={}, blocked={}", normalized, blocked);
        return new FixedExtensionResponse(fixed.getName(), fixed.isBlocked());
    }
}

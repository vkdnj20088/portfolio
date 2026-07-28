package com.portfolio.extension.service;

import com.portfolio.extension.domain.CustomExtension;
import com.portfolio.extension.dto.CustomCreatedResponse;
import com.portfolio.extension.dto.CustomItemResponse;
import com.portfolio.extension.dto.CustomListResponse;
import com.portfolio.extension.exception.DuplicateExtensionException;
import com.portfolio.extension.exception.ExtensionLimitExceededException;
import com.portfolio.extension.exception.ExtensionNotFoundException;
import com.portfolio.extension.exception.InvalidExtensionException;
import com.portfolio.extension.lock.DistributedLock;
import com.portfolio.extension.repository.CustomExtensionRepository;
import com.portfolio.extension.repository.FixedExtensionRepository;
import com.portfolio.extension.util.ExtensionNormalizer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.List;
import java.util.regex.Pattern;

@Service
public class CustomExtensionService {

    private static final Logger log = LoggerFactory.getLogger(CustomExtensionService.class);

    public static final int MAX_CUSTOM = 200;
    public static final int MAX_LENGTH = 20;
    /** 화이트리스트: 영문 소문자 + 숫자만. 블랙리스트는 예상 못한 우회를 허용하므로 채택하지 않는다. */
    private static final Pattern VALID = Pattern.compile("^[a-z0-9]{1," + MAX_LENGTH + "}$");

    /** 추가(확인-후-삽입) 임계 구역을 식별하는 락 키. */
    private static final String ADD_LOCK_KEY = "custom-extension-add";

    private final CustomExtensionRepository customExtensionRepository;
    private final FixedExtensionRepository fixedExtensionRepository;
    private final ExtensionNormalizer normalizer;
    private final TransactionTemplate transactionTemplate;
    private final ApplicationEventPublisher eventPublisher;
    /** 추가 임계 구역을 직렬화하는 락. 배포 형상에 따라 in-process/GET_LOCK/Redisson 으로 교체된다. */
    private final DistributedLock distributedLock;

    public CustomExtensionService(CustomExtensionRepository customExtensionRepository,
                                  FixedExtensionRepository fixedExtensionRepository,
                                  ExtensionNormalizer normalizer,
                                  PlatformTransactionManager transactionManager,
                                  ApplicationEventPublisher eventPublisher,
                                  DistributedLock distributedLock) {
        this.customExtensionRepository = customExtensionRepository;
        this.fixedExtensionRepository = fixedExtensionRepository;
        this.normalizer = normalizer;
        this.transactionTemplate = new TransactionTemplate(transactionManager);
        this.eventPublisher = eventPublisher;
        this.distributedLock = distributedLock;
    }

    @Transactional(readOnly = true)
    public CustomListResponse list() {
        List<CustomItemResponse> items = customExtensionRepository
                .findAll(Sort.by(Sort.Direction.DESC, "id")).stream()
                .map(c -> new CustomItemResponse(c.getId(), c.getName()))
                .toList();
        return new CustomListResponse(items, items.size(), MAX_CUSTOM);
    }

    /**
     * 커스텀 확장자 추가.
     *
     * <p>동시성: "개수 확인 -> 삽입"은 전형적인 TOCTOU 구간이다. 199개에서 두 요청이
     * 동시에 count 를 읽으면 둘 다 통과해 201개가 될 수 있다. 이를 막기 위해 임계 구역
     * <b>전체를 {@link DistributedLock} 으로 직렬화</b>하며, 락이 트랜잭션 커밋 시점까지 감싸도록
     * {@link TransactionTemplate}(프로그래매틱 트랜잭션)을 사용한다.
     * (자기호출 @Transactional 프록시 우회 문제도 함께 회피된다.)
     *
     * <p>스코프: 락 전략은 프로퍼티({@code app.distributed-lock.provider})로 교체된다 - 기본
     * in-process(단일 JVM), 다중 인스턴스는 MySQL {@code GET_LOCK} 또는 Redisson. 어느 쪽이든
     * {@code custom_extension.name UNIQUE} 제약이 최후의 방어선으로 중복 삽입을 막는다.
     */
    public CustomCreatedResponse add(String raw) {
        return distributedLock.executeWithLock(ADD_LOCK_KEY,
                () -> transactionTemplate.execute(status -> doAdd(raw)));
    }

    private CustomCreatedResponse doAdd(String raw) {
        String name = normalizer.normalize(raw);
        validateFormat(name);

        // 고정<->커스텀 교차 중복 방지(두 테이블이라 DB UNIQUE 로는 못 잡는 논리적 중복)
        if (fixedExtensionRepository.existsByName(name)) {
            throw new DuplicateExtensionException("고정 확장자와 중복됩니다: " + name);
        }
        if (customExtensionRepository.existsByName(name)) {
            throw new DuplicateExtensionException("이미 등록된 확장자입니다: " + name);
        }

        long count = customExtensionRepository.count();
        if (count >= MAX_CUSTOM) {
            throw new ExtensionLimitExceededException(
                    "커스텀 확장자는 최대 " + MAX_CUSTOM + "개까지 등록할 수 있습니다.");
        }

        try {
            CustomExtension saved = customExtensionRepository.saveAndFlush(new CustomExtension(name));
            long newCount = count + 1;
            // 커밋 후 캐시 무효화(BlocklistCacheEvictor, AFTER_COMMIT). 트랜잭션 안에서 발행해야
            // 커밋 후 리스너가 바인딩되고, evict 가 커밋보다 앞서는 stale 창이 생기지 않는다.
            eventPublisher.publishEvent(new BlocklistChangedEvent());
            log.info("custom extension added: name={}, count={}", name, newCount);
            return new CustomCreatedResponse(saved.getId(), saved.getName(), newCount);
        } catch (DataIntegrityViolationException e) {
            // UNIQUE 위반 = 락 밖(다중 인스턴스)에서 동시 삽입된 중복 -> 409 로 변환
            throw new DuplicateExtensionException("이미 등록된 확장자입니다: " + name);
        }
    }

    @Transactional
    public void delete(Long id) {
        if (!customExtensionRepository.existsById(id)) {
            throw new ExtensionNotFoundException("커스텀 확장자를 찾을 수 없습니다: id=" + id);
        }
        customExtensionRepository.deleteById(id);
        eventPublisher.publishEvent(new BlocklistChangedEvent()); // 커밋 후 캐시 무효화
        log.info("custom extension deleted: id={}", id);
    }

    private void validateFormat(String name) {
        if (name == null || name.isEmpty()) {
            throw new InvalidExtensionException("확장자를 입력해 주세요.");
        }
        if (name.length() > MAX_LENGTH) {
            throw new InvalidExtensionException("확장자는 최대 " + MAX_LENGTH + "자까지 입력할 수 있습니다.");
        }
        if (!VALID.matcher(name).matches()) {
            throw new InvalidExtensionException("확장자는 영문 소문자와 숫자만 사용할 수 있습니다: " + name);
        }
    }
}

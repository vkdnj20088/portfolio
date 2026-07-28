package com.portfolio.extension.config;

import com.portfolio.extension.domain.FixedExtension;
import com.portfolio.extension.repository.FixedExtensionRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

import java.util.Arrays;
import java.util.List;

/**
 * 고정 확장자 7종을 프로그래매틱하게 시드한다(존재하지 않을 때만 -> 멱등).
 *
 * data.sql 대신 이 방식을 택한 이유:
 *  - H2/MySQL 방언 차이(ON DUPLICATE KEY UPDATE 등)에 의존하지 않아 이식성이 높다.
 *  - Spring Boot 2.5+의 "data.sql이 Hibernate 스키마 생성보다 먼저 실행되는" 순서 함정
 *    (해결하려면 spring.jpa.defer-datasource-initialization=true 필요)을 원천적으로 회피한다.
 *
 * 아울러 비-prod 프로파일 기동을 경고한다(H2 인메모리로 조용히 운영되는 사고 방지).
 */
@Component
public class DataInitializer implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(DataInitializer.class);

    private static final List<String> FIXED_EXTENSIONS =
            List.of("bat", "cmd", "com", "cpl", "exe", "scr", "js");

    private final FixedExtensionRepository fixedExtensionRepository;
    private final Environment environment;

    public DataInitializer(FixedExtensionRepository fixedExtensionRepository, Environment environment) {
        this.fixedExtensionRepository = fixedExtensionRepository;
        this.environment = environment;
    }

    @Override
    public void run(ApplicationArguments args) {
        for (String name : FIXED_EXTENSIONS) {
            if (!fixedExtensionRepository.existsByName(name)) {
                fixedExtensionRepository.save(new FixedExtension(name, false));
            }
        }
        warnIfNonProd();
    }

    private void warnIfNonProd() {
        List<String> active = Arrays.asList(environment.getActiveProfiles());
        if (active.contains("prod")) {
            log.info("Active profile: prod");
        } else {
            log.warn("비-prod 프로파일로 기동 중(active={}). H2 인메모리(재시작 시 데이터 소실)/H2 콘솔이 "
                    + "활성화됩니다. 운영 배포 시 반드시 --spring.profiles.active=prod 로 실행하세요.", active);
        }
    }
}

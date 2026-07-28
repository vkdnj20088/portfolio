package com.portfolio.extension;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

// @EnableCaching 은 config/CachingConfig 로 분리(웹 슬라이스가 CacheManager 를 요구하지 않도록)
@SpringBootApplication
public class ExtensionBlockApplication {

    public static void main(String[] args) {
        SpringApplication.run(ExtensionBlockApplication.class, args);
    }
}

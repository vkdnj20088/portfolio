package com.portfolio.extension.dto.validation;

import jakarta.validation.Constraint;
import jakarta.validation.Payload;
import java.lang.annotation.Documented;
import java.lang.annotation.Retention;
import java.lang.annotation.Target;

import static java.lang.annotation.ElementType.FIELD;
import static java.lang.annotation.ElementType.PARAMETER;
import static java.lang.annotation.ElementType.RECORD_COMPONENT;
import static java.lang.annotation.RetentionPolicy.RUNTIME;

/**
 * 값이 유효한 IPv4/IPv6 주소 또는 CIDR 대역인지 검증한다(빈 값은 통과 - {@code @NotBlank} 와 조합).
 * 접수 계층(@Valid)에서 악성/오타 입력을 400 으로 막아 서비스가 항상 정상 IP 만 받게 한다.
 */
@Documented
@Constraint(validatedBy = IpOrCidrValidator.class)
@Target({FIELD, PARAMETER, RECORD_COMPONENT})
@Retention(RUNTIME)
public @interface ValidIpOrCidr {
    String message() default "올바른 IP 주소 또는 CIDR 대역이 아닙니다.";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};
}

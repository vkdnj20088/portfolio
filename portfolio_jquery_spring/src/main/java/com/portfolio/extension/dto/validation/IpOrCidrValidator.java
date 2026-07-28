package com.portfolio.extension.dto.validation;

import com.portfolio.extension.net.IpCidr;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

/**
 * {@link ValidIpOrCidr} 구현. 빈 값/공백은 통과시켜(@NotBlank 담당) 책임을 분리하고,
 * 형식 검증은 {@link IpCidr#isValid} 한곳에 위임한다.
 */
public class IpOrCidrValidator implements ConstraintValidator<ValidIpOrCidr, String> {

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        if (value == null || value.isBlank()) return true; // 공백은 @NotBlank 가 판정
        return IpCidr.isValid(value);
    }
}

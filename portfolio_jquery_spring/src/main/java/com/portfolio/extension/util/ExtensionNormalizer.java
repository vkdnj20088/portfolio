package com.portfolio.extension.util;

import org.springframework.stereotype.Component;

import java.util.Locale;
import java.util.regex.Pattern;

/**
 * 확장자 입력 정규화.
 * 저장/비교 전에 반드시 통과시킨다. 정규화 없이 중복 체크하면 EXE 와 exe 가
 * 별개로 저장되어 차단이 무력화된다.
 *
 * 규칙: 앞뒤 공백 제거 -> 소문자화(Locale.ROOT) -> 앞/뒤의 점(.) 제거.
 *   예) "EXE", ".exe", " exe ", "..EXE.." -> "exe"
 * 내부 점은 보존하며(예: "tar.gz"), 화이트리스트 검증에서 걸러진다
 * (차단 단위 = 최종 확장자 토큰 이라는 설계 결정).
 *
 * 소문자화에 Locale.ROOT 를 명시한다 - 기본 로케일(예: 터키어)에서 'I'->'ı' 로 바뀌어
 * 정상 입력이 화이트리스트에서 탈락하는 문제를 방지.
 */
@Component
public class ExtensionNormalizer {

    private static final Pattern SURROUNDING_DOTS = Pattern.compile("^\\.+|\\.+$");

    public String normalize(String raw) {
        if (raw == null) {
            return null;
        }
        String value = raw.trim().toLowerCase(Locale.ROOT);
        value = SURROUNDING_DOTS.matcher(value).replaceAll("");
        return value.trim();
    }
}

package com.portfolio.extension.relay;

/**
 * 결정적 의사난수(mulberry32) - 시드 하나로 동일 시퀀스를 재현한다.
 *
 * <p>거래소 데모(portfolio_exchange_next/lib/rng.ts)의 구현을 <b>비트 단위로 동일하게</b>
 * 자바로 옮긴 것이다. 같은 시드가 프론트와 백엔드에서 같은 수열을 내야, 화면이 서버 결과를
 * 미리 그려 볼 수 있고 테스트가 양쪽에서 같은 기대값을 쓴다. 32비트 산술은 int 오버플로가
 * JS 의 {@code Math.imul}/{@code |0} 과 같은 결과를 내므로 자바 int 연산으로 정확히 대응된다.
 *
 * <p>주기 2^32, 통계 품질은 데모 시뮬레이션에 충분하다. 보안 용도가 아니다(§0 데모).
 */
public final class Mulberry32 {

    private int state;

    public Mulberry32(int seed) {
        this.state = seed;
    }

    /** [0, 1) 구간의 다음 값. JS 원본: (t ^ t>>>14) >>> 0) / 4294967296. */
    public double next() {
        state += 0x6d2b79f5;
        int t = state;
        t = (t ^ (t >>> 15)) * (1 | t);
        t = (t + ((t ^ (t >>> 7)) * (61 | t))) ^ t;
        long unsigned = Integer.toUnsignedLong(t ^ (t >>> 14));
        return unsigned / 4294967296.0;
    }

    /**
     * 문자열을 32bit 시드로(FNV-1a) - 같은 문자열은 항상 같은 시드.
     * 거래소의 hashSeed 와 동일 알고리즘. charCodeAt 대응은 UTF-16 코드 유닛이다.
     */
    public static int hashSeed(String input) {
        int h = (int) 2166136261L;
        for (int i = 0; i < input.length(); i++) {
            h ^= input.charAt(i);
            h *= 16777619;
        }
        return h;
    }
}

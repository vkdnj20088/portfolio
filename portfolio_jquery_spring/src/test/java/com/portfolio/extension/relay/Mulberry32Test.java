package com.portfolio.extension.relay;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.offset;

/**
 * 거래소 데모의 JS 구현(lib/rng.ts)과 <b>비트 단위 동일</b>함을 골든 값으로 고정한다.
 * 기대값은 node 로 JS 원본을 실행해 뽑았다 - 이 계약이 깨지면 "프론트가 서버 결과를
 * 미리 그린다"는 전제가 무너지므로, 알고리즘을 손대면 이 테스트가 먼저 알린다.
 */
class Mulberry32Test {

    @Test
    void matchesJsGoldenSequence() {
        // node: mulberry32(20260801) 첫 5개
        Mulberry32 rng = new Mulberry32(20260801);
        double[] expected = {
                0.25129492254927754, 0.97715961071662605, 0.53597823949530721,
                0.07717855530790985, 0.90425843675620854,
        };
        for (double want : expected) {
            assertThat(rng.next()).isCloseTo(want, offset(1e-15));
        }
    }

    @Test
    void matchesJsGoldenHashSeed() {
        // node: hashSeed("job-8f2a") = 2754601724 (uint32) = -1540365572 (int32)
        assertThat(Mulberry32.hashSeed("job-8f2a")).isEqualTo(-1540365572);
    }

    @Test
    void hashChainedIntoRngMatchesJs() {
        // node: mulberry32(hashSeed("job-8f2a")|0) 첫 2개
        Mulberry32 rng = new Mulberry32(Mulberry32.hashSeed("job-8f2a"));
        assertThat(rng.next()).isCloseTo(0.21134817739948630, offset(1e-15));
        assertThat(rng.next()).isCloseTo(0.80923979822546244, offset(1e-15));
    }
}

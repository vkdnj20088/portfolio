package com.portfolio.extension.net;

import java.util.Arrays;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * IP/CIDR 값객체 - 파싱/정규화/포함 매칭을 못박는다. 경계(프리픽스 0/최대), 악성/오타 입력,
 * IPv6 축약(RFC 5952)/IPv4-mapped, CIDR 포함 판정까지 커버.
 */
class IpCidrTest {

    // ── IPv4 파싱/검증 ────────────────────────────────────────────────────

    @Test
    void ipv4_singleHost_canonicalIsSame() {
        assertThat(IpCidr.parse("192.168.0.1").canonical()).isEqualTo("192.168.0.1");
    }

    @ParameterizedTest
    @ValueSource(strings = {
        "256.0.0.1",       // 마디 > 255
        "192.168.0",       // 마디 부족
        "192.168.0.1.5",   // 마디 초과
        "192.168.00.1",    // 선행 0(8진수 혼동 방지)
        "192.168.0.",      // 빈 마디
        "192.168.0.-1",    // 음수/비숫자
        "abc.def.ghi.jkl", // 비숫자
        "",                // 빈 값
        "   ",             // 공백
    })
    void ipv4_malformed_isRejected(String bad) {
        assertThat(IpCidr.isValid(bad)).isFalse();
        assertThatThrownBy(() -> IpCidr.parse(bad)).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void ipv4_boundaryAddresses_areValid() {
        assertThat(IpCidr.isValid("0.0.0.0")).isTrue();
        assertThat(IpCidr.isValid("255.255.255.255")).isTrue();
    }

    // ── IPv4 CIDR 포함 ────────────────────────────────────────────────────

    @Test
    void ipv4_cidr_masksHostBits_onCanonical() {
        // 입력의 host 비트가 남아 있어도 네트워크로 정규화된다.
        assertThat(IpCidr.parse("192.168.1.77/24").canonical()).isEqualTo("192.168.1.0/24");
    }

    @Test
    void ipv4_cidr_containsAddressesInRange() {
        IpCidr net = IpCidr.parse("10.0.0.0/24");
        assertThat(net.containsAddress("10.0.0.1")).isTrue();
        assertThat(net.containsAddress("10.0.0.255")).isTrue();
        assertThat(net.containsAddress("10.0.1.0")).isFalse();   // 다음 네트워크
        assertThat(net.containsAddress("10.0.0.0/25")).isTrue(); // 더 좁은 대역은 포함
        assertThat(net.containsAddress("10.0.0.0/23")).isFalse();// 더 넓은 대역은 미포함
    }

    @Test
    void ipv4_prefixBoundaries() {
        assertThat(IpCidr.parse("0.0.0.0/0").containsAddress("8.8.8.8")).isTrue(); // /0 은 전부 포함
        assertThat(IpCidr.parse("1.2.3.4/32").isSingleHost()).isTrue();
        assertThat(IpCidr.isValid("1.2.3.4/33")).isFalse(); // 프리픽스 초과
        assertThat(IpCidr.isValid("1.2.3.4/x")).isFalse();  // 비숫자 프리픽스
    }

    // ── IPv6 파싱/정규화 ──────────────────────────────────────────────────

    @Test
    void ipv6_compression_rfc5952() {
        assertThat(IpCidr.parse("2001:0db8:0000:0000:0000:0000:0000:0001").canonical())
                .isEqualTo("2001:db8::1"); // 선행 0 제거 + 최장 0-런 축약
        assertThat(IpCidr.parse("::").canonical()).isEqualTo("::"); // 전부 0
        assertThat(IpCidr.parse("::1").canonical()).isEqualTo("::1"); // 루프백
        assertThat(IpCidr.parse("2001:DB8::AB").canonical()).isEqualTo("2001:db8::ab"); // 소문자화
    }

    @Test
    void ipv6_mapped_normalizesToIpv4() {
        // ::ffff:a.b.c.d 는 IPv4 로 통일(같은 호스트를 한 표기로).
        IpCidr mapped = IpCidr.parse("::ffff:192.168.0.1");
        assertThat(mapped.family()).isEqualTo(IpCidr.Family.IPV4);
        assertThat(mapped.canonical()).isEqualTo("192.168.0.1");
    }

    @ParameterizedTest
    @ValueSource(strings = {
        "2001::db8::1",    // '::' 중복
        "2001:db8:::1",    // 잘못된 콜론
        "gggg::1",         // 비-16진
        "1:2:3:4:5:6:7:8:9", // 그룹 초과
        "12345::1",        // 그룹 4자리 초과
        "2001:db8::/129",  // IPv6 프리픽스 초과
    })
    void ipv6_malformed_isRejected(String bad) {
        assertThat(IpCidr.isValid(bad)).isFalse();
    }

    @Test
    void ipv6_cidr_containment() {
        IpCidr net = IpCidr.parse("2001:db8::/32");
        assertThat(net.containsAddress("2001:db8:abcd::1")).isTrue();
        assertThat(net.containsAddress("2001:db9::1")).isFalse();
        assertThat(net.canonical()).isEqualTo("2001:db8::/32");
    }

    // ── 교차 패밀리 ───────────────────────────────────────────────────────

    @Test
    void crossFamily_neverContains() {
        assertThat(IpCidr.parse("10.0.0.0/8").containsAddress("2001:db8::1")).isFalse();
        assertThat(IpCidr.parse("::/0").containsAddress("10.0.0.1")).isFalse();
    }

    @Test
    void equalsAndHashCode_byNormalizedValue() {
        assertThat(IpCidr.parse("2001:db8::1")).isEqualTo(IpCidr.parse("2001:0db8:0:0:0:0:0:1"));
        assertThat(IpCidr.parse("192.168.1.10/24")).isEqualTo(IpCidr.parse("192.168.1.0/24"));
    }

    // ── 범위 인덱스용 16바이트 시작/끝(#I6) ─────────────────────────────────

    @Test
    void rangeBytes_boundsAreConsistentWithContains() {
        IpCidr net = IpCidr.parse("10.0.0.0/24");
        byte[] lo = net.firstAddress16();
        byte[] hi = net.lastAddress16();
        assertThat(Arrays.compareUnsigned(lo, hi)).isLessThanOrEqualTo(0);
        byte[] in = IpCidr.parse("10.0.0.128").firstAddress16();
        byte[] out = IpCidr.parse("10.0.1.0").firstAddress16();
        assertThat(within(lo, in, hi)).isTrue();   // 대역 안
        assertThat(within(lo, out, hi)).isFalse();  // 대역 밖
    }

    @Test
    void rangeBytes_singleHost_startEqualsEnd() {
        IpCidr h = IpCidr.parse("1.2.3.4");
        assertThat(h.firstAddress16()).isEqualTo(h.lastAddress16());
    }

    @Test
    void rangeBytes_ipv4MappedIntoSharedSpace() {
        byte[] b = IpCidr.parse("1.2.3.4").firstAddress16();
        assertThat(b).hasSize(16);
        assertThat(b[10] & 0xff).isEqualTo(0xff); // ::ffff: 접두
        assertThat(b[11] & 0xff).isEqualTo(0xff);
        assertThat(b[12] & 0xff).isEqualTo(1);
    }

    @Test
    void rangeBytes_ipv6Network() {
        IpCidr net = IpCidr.parse("2001:db8::/32");
        byte[] in = IpCidr.parse("2001:db8:abcd::1").firstAddress16();
        assertThat(within(net.firstAddress16(), in, net.lastAddress16())).isTrue();
    }

    private static boolean within(byte[] lo, byte[] x, byte[] hi) {
        return Arrays.compareUnsigned(lo, x) <= 0 && Arrays.compareUnsigned(x, hi) <= 0;
    }
}

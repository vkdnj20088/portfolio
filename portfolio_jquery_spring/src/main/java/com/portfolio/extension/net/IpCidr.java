package com.portfolio.extension.net;

import java.util.Arrays;

/**
 * IP 주소/CIDR 대역 값객체 - 파싱/정규화/포함(containment) 매칭을 한곳에 모은다.
 *
 * <p>불투명한 VARCHAR 문자열 대신 이 값객체를 경계에 두면 (1) 악성/오타 입력을 접수 시점에 거절하고,
 * (2) 표기 흔들림(IPv6 축약/대소문자/선행 0)을 canonical 로 정규화하며, (3) "이 IP 가 이 규칙 대역에
 * 걸리나"를 비트 연산으로 정확히 판정할 수 있다.
 *
 * <p>설계 원칙:
 * <ul>
 *   <li>DNS 를 타지 않는다 - 텍스트를 직접 바이트로 파싱한다({@code InetAddress.getByName} 은
 *       호스트명이면 네트워크 조회를 유발하므로 쓰지 않는다).</li>
 *   <li>IPv4-mapped IPv6({@code ::ffff:a.b.c.d}) 는 IPv4 로 정규화한다 - 같은 호스트를 한 가지로 본다.</li>
 *   <li>IPv4 는 선행 0 을 거절한다({@code 192.168.001.001}) - 8진수 혼동/우회를 막는다.</li>
 *   <li>대역은 접수 시 host 비트를 0 으로 마스킹해 저장한다 - 포함 판정이 항상 네트워크 기준.</li>
 * </ul>
 */
public final class IpCidr {

    public enum Family {
        IPV4(32), IPV6(128);
        final int bits;
        Family(int bits) { this.bits = bits; }
    }

    private final byte[] network; // 마스킹된 네트워크 바이트(4 또는 16)
    private final int prefixLen;
    private final Family family;

    private IpCidr(byte[] network, int prefixLen, Family family) {
        this.network = network;
        this.prefixLen = prefixLen;
        this.family = family;
    }

    /** 유효하면 값객체, 아니면 사유를 담은 {@link IllegalArgumentException}. */
    public static IpCidr parse(String text) {
        if (text == null) throw new IllegalArgumentException("IP 값이 비어 있습니다.");
        String s = text.strip();
        if (s.isEmpty()) throw new IllegalArgumentException("IP 값이 비어 있습니다.");

        String addrPart = s;
        int prefix = -1;
        int slash = s.indexOf('/');
        if (slash >= 0) {
            addrPart = s.substring(0, slash);
            String prefixStr = s.substring(slash + 1);
            if (prefixStr.isEmpty() || !isAllDigits(prefixStr)) {
                throw new IllegalArgumentException("CIDR 프리픽스가 올바르지 않습니다: " + s);
            }
            try {
                prefix = Integer.parseInt(prefixStr);
            } catch (NumberFormatException e) {
                throw new IllegalArgumentException("CIDR 프리픽스가 너무 큽니다: " + s);
            }
        }

        byte[] addr;
        Family family;
        if (addrPart.indexOf(':') >= 0) {
            addr = parseIpv6(addrPart);
            if (isIpv4Mapped(addr)) { // ::ffff:a.b.c.d -> IPv4 로 정규화
                addr = Arrays.copyOfRange(addr, 12, 16);
                family = Family.IPV4;
            } else {
                family = Family.IPV6;
            }
        } else {
            addr = parseIpv4(addrPart);
            family = Family.IPV4;
        }

        if (prefix < 0) prefix = family.bits; // 단일 호스트 = 풀 프리픽스
        if (prefix > family.bits) {
            throw new IllegalArgumentException(
                    "프리픽스는 0.." + family.bits + " 범위여야 합니다: " + s);
        }
        return new IpCidr(mask(addr, prefix), prefix, family);
    }

    /** 예외 없이 유효성만 판정. */
    public static boolean isValid(String text) {
        try {
            parse(text);
            return true;
        } catch (RuntimeException e) {
            return false;
        }
    }

    /** 이 대역이 {@code other} 대역(또는 단일 IP)을 완전히 포함하는가. */
    public boolean contains(IpCidr other) {
        if (this.family != other.family) return false; // v4 대역은 v6 를 포함하지 않는다
        if (other.prefixLen < this.prefixLen) return false; // 더 넓은 대역은 포함되지 않음
        return bitsMatch(this.network, other.network, this.prefixLen);
    }

    /** 문자열 IP 가 이 대역에 걸리는가(파싱 실패는 false). */
    public boolean containsAddress(String ip) {
        try {
            return contains(parse(ip));
        } catch (RuntimeException e) {
            return false;
        }
    }

    public boolean isSingleHost() { return prefixLen == family.bits; }
    public Family family() { return family; }
    public int prefixLen() { return prefixLen; }

    /**
     * 범위 인덱스용 16바이트 정규화 시작 주소(대역의 최소 IP). IPv4 는 IPv4-mapped(::ffff:a.b.c.d)로
     * 16바이트에 담아 v4/v6 를 한 공간에서 byte-wise 로 비교할 수 있게 한다.
     */
    public byte[] firstAddress16() { return map16(networkWithHost(false)); }

    /** 범위 인덱스용 16바이트 정규화 끝 주소(대역의 최대 IP = 네트워크 | host 마스크). */
    public byte[] lastAddress16() { return map16(networkWithHost(true)); }

    /** 정규화 표기 - IPv6 는 RFC 5952 축약, 단일 호스트는 프리픽스 생략. */
    public String canonical() {
        String host = family == Family.IPV4 ? ipv4ToString(network) : ipv6ToString(network);
        return isSingleHost() ? host : host + "/" + prefixLen;
    }

    @Override public String toString() { return canonical(); }

    @Override public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof IpCidr other)) return false;
        return prefixLen == other.prefixLen && family == other.family
                && Arrays.equals(network, other.network);
    }

    @Override public int hashCode() {
        return Arrays.hashCode(network) * 31 + prefixLen * 7 + family.hashCode();
    }

    // ── IPv4 ────────────────────────────────────────────────────────────────

    private static byte[] parseIpv4(String s) {
        String[] parts = s.split("\\.", -1);
        if (parts.length != 4) throw new IllegalArgumentException("IPv4 는 점 4마디여야 합니다: " + s);
        byte[] out = new byte[4];
        for (int i = 0; i < 4; i++) {
            String p = parts[i];
            if (p.isEmpty() || p.length() > 3 || !isAllDigits(p)) {
                throw new IllegalArgumentException("IPv4 마디가 올바르지 않습니다: " + s);
            }
            if (p.length() > 1 && p.charAt(0) == '0') {
                throw new IllegalArgumentException("IPv4 마디에 선행 0 은 허용하지 않습니다: " + s);
            }
            int v = Integer.parseInt(p);
            if (v > 255) throw new IllegalArgumentException("IPv4 마디는 0..255 여야 합니다: " + s);
            out[i] = (byte) v;
        }
        return out;
    }

    private static String ipv4ToString(byte[] b) {
        return (b[0] & 0xff) + "." + (b[1] & 0xff) + "." + (b[2] & 0xff) + "." + (b[3] & 0xff);
    }

    // ── IPv6 ────────────────────────────────────────────────────────────────

    private static byte[] parseIpv6(String s) {
        if (s.indexOf('%') >= 0) throw new IllegalArgumentException("IPv6 존 식별자는 지원하지 않습니다: " + s);
        int dc = s.indexOf("::");
        int[] groups;
        if (dc >= 0) {
            if (s.indexOf("::", dc + 1) >= 0) {
                throw new IllegalArgumentException("IPv6 에 '::' 는 한 번만 올 수 있습니다: " + s);
            }
            int[] head = parseHextets(s.substring(0, dc));
            int[] tail = parseHextets(s.substring(dc + 2));
            int total = head.length + tail.length;
            if (total > 7) throw new IllegalArgumentException("IPv6 그룹 수가 과다합니다: " + s);
            groups = new int[8];
            System.arraycopy(head, 0, groups, 0, head.length);
            System.arraycopy(tail, 0, groups, 8 - tail.length, tail.length);
        } else {
            groups = parseHextets(s);
            if (groups.length != 8) throw new IllegalArgumentException("IPv6 는 8그룹이어야 합니다: " + s);
        }
        byte[] out = new byte[16];
        for (int i = 0; i < 8; i++) {
            out[i * 2] = (byte) (groups[i] >> 8);
            out[i * 2 + 1] = (byte) groups[i];
        }
        return out;
    }

    // "::" 로 나뉜 한쪽을 그룹 배열로. 마지막 그룹은 내장 IPv4(dotted) 일 수 있다.
    private static int[] parseHextets(String part) {
        if (part.isEmpty()) return new int[0];
        String[] segs = part.split(":", -1);
        int[] tmp = new int[segs.length + 1]; // 내장 IPv4 는 2그룹으로 확장
        int n = 0;
        for (int i = 0; i < segs.length; i++) {
            String seg = segs[i];
            if (seg.indexOf('.') >= 0) {
                if (i != segs.length - 1) {
                    throw new IllegalArgumentException("내장 IPv4 는 맨 끝에만 올 수 있습니다: " + part);
                }
                byte[] v4 = parseIpv4(seg);
                tmp[n++] = ((v4[0] & 0xff) << 8) | (v4[1] & 0xff);
                tmp[n++] = ((v4[2] & 0xff) << 8) | (v4[3] & 0xff);
            } else {
                if (seg.isEmpty() || seg.length() > 4 || !isHex(seg)) {
                    throw new IllegalArgumentException("IPv6 그룹이 올바르지 않습니다: " + part);
                }
                tmp[n++] = Integer.parseInt(seg, 16);
            }
        }
        return Arrays.copyOf(tmp, n);
    }

    private static boolean isIpv4Mapped(byte[] b) {
        if (b.length != 16) return false;
        for (int i = 0; i < 10; i++) if (b[i] != 0) return false;
        return (b[10] & 0xff) == 0xff && (b[11] & 0xff) == 0xff;
    }

    // RFC 5952: 소문자, 그룹 선행 0 제거, 최장 0-런(길이>=2) 을 "::" 로(동률은 최좌측).
    private static String ipv6ToString(byte[] b) {
        int[] g = new int[8];
        for (int i = 0; i < 8; i++) g[i] = ((b[i * 2] & 0xff) << 8) | (b[i * 2 + 1] & 0xff);
        int bestStart = -1, bestLen = 0, curStart = -1, curLen = 0;
        for (int i = 0; i < 8; i++) {
            if (g[i] == 0) {
                if (curStart < 0) { curStart = i; curLen = 1; } else { curLen++; }
                if (curLen > bestLen) { bestLen = curLen; bestStart = curStart; }
            } else {
                curStart = -1; curLen = 0;
            }
        }
        if (bestLen < 2) bestStart = -1;
        String[] parts = new String[8];
        for (int i = 0; i < 8; i++) parts[i] = Integer.toHexString(g[i]);
        if (bestStart < 0) return String.join(":", parts);
        String left = String.join(":", Arrays.copyOfRange(parts, 0, bestStart));
        String right = String.join(":", Arrays.copyOfRange(parts, bestStart + bestLen, 8));
        return left + "::" + right;
    }

    // ── 공통 ────────────────────────────────────────────────────────────────

    // 네트워크 바이트에 host 비트를 채우거나(끝 주소) 그대로 둔다(시작 주소 = 이미 마스킹됨).
    private byte[] networkWithHost(boolean fillHost) {
        byte[] b = network.clone();
        if (!fillHost) return b;
        for (int i = 0; i < b.length; i++) {
            int bitsHere = prefixLen - i * 8;
            if (bitsHere >= 8) continue;                 // 전부 네트워크
            if (bitsHere <= 0) { b[i] = (byte) 0xff; continue; } // 전부 host
            b[i] = (byte) (b[i] | (0xff >> bitsHere));   // 하위 (8-bitsHere) 비트를 1로
        }
        return b;
    }

    // 4바이트 IPv4 는 IPv4-mapped 16바이트로, 16바이트는 그대로.
    private static byte[] map16(byte[] addr) {
        if (addr.length == 16) return addr;
        byte[] out = new byte[16];
        out[10] = (byte) 0xff;
        out[11] = (byte) 0xff;
        System.arraycopy(addr, 0, out, 12, 4);
        return out;
    }

    private static byte[] mask(byte[] addr, int prefixLen) {
        byte[] out = addr.clone();
        for (int i = 0; i < out.length; i++) {
            int bitsHere = prefixLen - i * 8;
            if (bitsHere >= 8) continue;          // 이 바이트는 전부 네트워크
            if (bitsHere <= 0) { out[i] = 0; continue; } // 전부 host -> 0
            int keep = 0xff << (8 - bitsHere);    // 상위 bitsHere 비트만 유지
            out[i] = (byte) (out[i] & keep);
        }
        return out;
    }

    private static boolean bitsMatch(byte[] a, byte[] b, int prefixLen) {
        int full = prefixLen / 8;
        for (int i = 0; i < full; i++) if (a[i] != b[i]) return false;
        int rem = prefixLen % 8;
        if (rem == 0) return true;
        int m = 0xff << (8 - rem);
        return (a[full] & m) == (b[full] & m);
    }

    private static boolean isAllDigits(String s) {
        for (int i = 0; i < s.length(); i++) if (!Character.isDigit(s.charAt(i))) return false;
        return true;
    }

    private static boolean isHex(String s) {
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            boolean ok = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
            if (!ok) return false;
        }
        return true;
    }
}

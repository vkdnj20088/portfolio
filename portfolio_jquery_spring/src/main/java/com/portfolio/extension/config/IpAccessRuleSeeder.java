package com.portfolio.extension.config;

import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ThreadLocalRandom;
import com.portfolio.extension.domain.IpAccessRule;
import com.portfolio.extension.net.IpCidr;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.CommandLineRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * IP 규칙 더미 데이터 시더(요건: 100만 건). app.ip-seed.count &gt; 0 이고 아직 목표치에 못 미칠 때만
 * JDBC 배치로 대량 삽입한다. 기본 0 이라 로컬/테스트는 시딩하지 않는다(테스트 속도 보존).
 * 라이브 데모(MySQL)는 app.ip-seed.count=1000000(환경변수 APP_IP-SEED_COUNT)으로 한 번 채운다.
 *
 * <p>성능: 10,000행 단위 배치 + prod JDBC URL 의 rewriteBatchedStatements=true 로 왕복을 최소화한다.
 * TZ 정합: 시각은 UTC 벽시계 문자열로 바인딩한다(DATETIME 은 TZ 가 없으므로 JPA 읽기(jdbc.time_zone=UTC)와
 * 정확히 일치). 컴플라이언스: 내용은 제네릭 문구로 생성(실서비스/실브랜드 배제).
 */
@Component
public class IpAccessRuleSeeder implements CommandLineRunner {

    private static final Logger log = LoggerFactory.getLogger(IpAccessRuleSeeder.class);
    private static final int BATCH = 10_000;
    private static final DateTimeFormatter UTC =
            DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss").withZone(ZoneOffset.UTC);
    private static final String[] NOTES = {
            "관리자 접근 IP", "사내망 대역", "협력사 API 서버", "모니터링 봇", "배치 작업 서버",
            "운영자 재택 IP", "결제 게이트웨이", "외부 연동 서버", "테스트 자동화", "백오피스 접근"
    };

    private final JdbcTemplate jdbc;
    private final long targetCount;

    public IpAccessRuleSeeder(JdbcTemplate jdbc, @Value("${app.ip-seed.count:0}") long targetCount) {
        this.jdbc = jdbc;
        this.targetCount = targetCount;
    }

    @Override
    public void run(String... args) {
        if (targetCount <= 0) {
            return;
        }
        Long existing = jdbc.queryForObject("SELECT COUNT(*) FROM ip_access_rule", Long.class);
        long have = existing == null ? 0 : existing;
        if (have >= targetCount) {
            log.info("IP 규칙 시딩 생략 - 이미 {}건(목표 {})", have, targetCount);
            return;
        }
        long toInsert = targetCount - have;
        log.info("IP 규칙 더미 {}건 시딩 시작(배치 {})", toInsert, BATCH);
        long t0 = System.currentTimeMillis();
        Instant base = Instant.now().minus(365, ChronoUnit.DAYS);

        long done = 0;
        while (done < toInsert) {
            int n = (int) Math.min(BATCH, toInsert - done);
            List<Object[]> rows = new ArrayList<>(n);
            for (int i = 0; i < n; i++) {
                ThreadLocalRandom r = ThreadLocalRandom.current();
                String ip = r.nextInt(1, 224) + "." + r.nextInt(256) + "." + r.nextInt(256) + "." + r.nextInt(1, 255);
                String note = trim20(NOTES[r.nextInt(NOTES.length)] + " " + r.nextInt(1000));
                Instant start = base.plus(r.nextLong(0, 365L * 24 * 60), ChronoUnit.MINUTES);
                Instant end = start.plus(r.nextLong(1, 60L * 24), ChronoUnit.MINUTES);
                Instant created = base.plus(r.nextLong(0, 365L * 24 * 60), ChronoUnit.MINUTES);
                // 범위 컬럼도 채운다(#O2) - 엔티티 경로와 동일하게 IpCidr 로 16바이트 정규화 시작/끝을 계산해,
                // 시딩한 행도 /containing(범위 인덱스 조회)에 정확히 잡히게 한다(단일 IP 라 start==end).
                IpCidr cidr = IpCidr.parse(ip);
                // action/priority(#G1)를 명시한다. Flyway DDL 에는 DEFAULT 가 있지만 테스트 스키마는
                // Hibernate 가 생성해 DEFAULT 가 없다 - 컬럼을 생략하면 NOT NULL 위반으로 시딩이 죽는다.
                // 컬럼을 늘릴 때 raw INSERT 를 함께 고쳐야 한다는 것을 드러내려고 값을 적어 둔다.
                rows.add(new Object[]{ip, note, UTC.format(start), UTC.format(end), UTC.format(created),
                        cidr.firstAddress16(), cidr.lastAddress16(), 0L, // version=0 기준(#Q2 @Version NOT NULL)
                        IpAccessRule.Action.ALLOW.name(), IpAccessRule.DEFAULT_PRIORITY});
            }
            jdbc.batchUpdate("INSERT INTO ip_access_rule "
                    + "(ip_address, description, start_at, end_at, created_at, ip_start, ip_end, version, "
                    + "action, priority) "
                    + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", rows);
            done += n;
            if (done % (BATCH * 10L) == 0) {
                log.info("  ...{}/{}", done, toInsert);
            }
        }
        log.info("IP 규칙 시딩 완료 {}건 ({}ms)", toInsert, System.currentTimeMillis() - t0);
    }

    private static String trim20(String s) {
        return s.length() > 20 ? s.substring(0, 20) : s;
    }
}

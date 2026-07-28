package com.portfolio.extension.lock;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.function.Supplier;

/**
 * MySQL 네임드 락({@code GET_LOCK}/{@code RELEASE_LOCK}) 기반 분산 락({@code provider=mysql}).
 *
 * <p>공유 MySQL 을 쓰는 다중 인스턴스에서 별도 인프라(Redis 등) 없이 클러스터 전역 직렬화를 얻는다.
 * 락은 세션(커넥션) 스코프이므로 <b>같은 커넥션에서 획득하고 해제</b>해야 한다 - 그래서 락 전용
 * 커넥션 하나를 잡아 임계 구역 동안 유지한다. 내부 {@code action}(JPA 트랜잭션)은 풀의 다른
 * 커넥션에서 돌지만, 모든 인스턴스가 같은 이름의 락을 두고 경합하므로 직렬화는 유지된다.
 *
 * <p><b>트레이드오프(중요)</b>: 대기자도 각자 커넥션 하나를 점유한 채 {@code GET_LOCK} 안에서
 * 블록된다. 즉 동시 대기 수만큼 커넥션이 소모되므로, 팬인이 큰 임계 구역이면 커넥션 풀을 그에 맞게
 * 키우거나(권장: 짧은 timeout + 애플리케이션 레벨 재시도) in-process/Redisson 처럼 대기가 DB
 * 커넥션을 잡지 않는 전략을 택해야 한다. 이 앱의 추가 임계 구역은 팬인이 작아 문제되지 않는다.
 */
@Component
@ConditionalOnProperty(name = "app.distributed-lock.provider", havingValue = "mysql")
public class MySqlNamedLock implements DistributedLock {

    private final DataSource dataSource;
    private final int timeoutSeconds;

    public MySqlNamedLock(DataSource dataSource,
                          @Value("${app.distributed-lock.timeout-seconds:10}") int timeoutSeconds) {
        this.dataSource = dataSource;
        this.timeoutSeconds = timeoutSeconds;
    }

    @Override
    public <T> T executeWithLock(String key, Supplier<T> action) {
        try (Connection conn = dataSource.getConnection()) {
            acquire(conn, key);
            try {
                return action.get();
            } finally {
                release(conn, key);
            }
        } catch (SQLException e) {
            throw new IllegalStateException("분산 락 처리 중 DB 오류: key=" + key, e);
        }
    }

    /** {@code GET_LOCK} 은 1(획득)/0(timeout)/NULL(오류)을 돌려준다(BIGINT). 1 이 아니면 실패로 던진다. */
    private void acquire(Connection conn, String key) throws SQLException {
        try (PreparedStatement ps = conn.prepareStatement("SELECT GET_LOCK(?, ?)")) {
            ps.setString(1, key);
            ps.setInt(2, timeoutSeconds);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) {
                    throw new IllegalStateException("분산 락 응답 없음: key=" + key);
                }
                long result = rs.getLong(1);
                if (rs.wasNull() || result != 1L) {
                    throw new IllegalStateException(
                            "분산 락 획득 실패(timeout=" + timeoutSeconds + "s): key=" + key);
                }
            }
        }
    }

    private void release(Connection conn, String key) throws SQLException {
        try (PreparedStatement ps = conn.prepareStatement("SELECT RELEASE_LOCK(?)")) {
            ps.setString(1, key);
            ps.execute();
        }
    }
}

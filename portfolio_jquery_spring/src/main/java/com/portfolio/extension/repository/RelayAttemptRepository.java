package com.portfolio.extension.repository;

import com.portfolio.extension.domain.RelayAttempt;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface RelayAttemptRepository extends JpaRepository<RelayAttempt, Long> {

    List<RelayAttempt> findByJobIdOrderByRunAscAttemptNoAsc(Long jobId);

    List<RelayAttempt> findByJobIdInOrderByJobIdAscRunAscAttemptNoAsc(List<Long> jobIds);
}

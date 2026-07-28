package com.portfolio.extension.repository;

import com.portfolio.extension.domain.FixedExtension;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface FixedExtensionRepository extends JpaRepository<FixedExtension, Long> {

    Optional<FixedExtension> findByName(String name);

    boolean existsByName(String name);
}

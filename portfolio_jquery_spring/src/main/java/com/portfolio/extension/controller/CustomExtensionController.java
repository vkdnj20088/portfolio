package com.portfolio.extension.controller;

import com.portfolio.extension.dto.CustomCreatedResponse;
import com.portfolio.extension.dto.CustomExtensionRequest;
import com.portfolio.extension.dto.CustomListResponse;
import com.portfolio.extension.service.CustomExtensionService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/extensions/custom")
public class CustomExtensionController {

    private final CustomExtensionService customExtensionService;

    public CustomExtensionController(CustomExtensionService customExtensionService) {
        this.customExtensionService = customExtensionService;
    }

    @GetMapping
    public CustomListResponse list() {
        return customExtensionService.list();
    }

    @PostMapping
    public ResponseEntity<CustomCreatedResponse> add(@Valid @RequestBody CustomExtensionRequest request) {
        CustomCreatedResponse response = customExtensionService.add(request.name());
        return ResponseEntity.status(HttpStatus.CREATED).body(response); // 201
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        customExtensionService.delete(id);
        return ResponseEntity.noContent().build(); // 204
    }
}

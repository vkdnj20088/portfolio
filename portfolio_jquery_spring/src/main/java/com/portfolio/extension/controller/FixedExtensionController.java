package com.portfolio.extension.controller;

import com.portfolio.extension.dto.FixedExtensionResponse;
import com.portfolio.extension.dto.FixedToggleRequest;
import com.portfolio.extension.service.FixedExtensionService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/extensions/fixed")
public class FixedExtensionController {

    private final FixedExtensionService fixedExtensionService;

    public FixedExtensionController(FixedExtensionService fixedExtensionService) {
        this.fixedExtensionService = fixedExtensionService;
    }

    @GetMapping
    public List<FixedExtensionResponse> list() {
        return fixedExtensionService.list();
    }

    @PatchMapping("/{name}")
    public FixedExtensionResponse toggle(@PathVariable String name,
                                         @Valid @RequestBody FixedToggleRequest request) {
        return fixedExtensionService.toggle(name, request.blocked());
    }
}

package com.portfolio.extension.dto;

/**
 * 파일 첨부 검증 결과.
 *
 * @param allowed             첨부 허용 여부
 * @param reason              차단/허용 사유(사용자 표시용)
 * @param extension           추출된 확장자(없으면 null)
 * @param detectedSignature   내용에서 감지된 위험 시그니처/MIME(없으면 null)
 * @param storedId            통과 후 안전 격리 저장된 파일의 id(차단 시 null)
 */
public record FileValidationResponse(
        boolean allowed,
        String reason,
        String extension,
        String detectedSignature,
        String storedId) {

    public static FileValidationResponse allow(String extension) {
        return new FileValidationResponse(true, "첨부 가능한 파일입니다.", extension, null, null);
    }

    public static FileValidationResponse block(String reason, String extension, String signature) {
        return new FileValidationResponse(false, reason, extension, signature, null);
    }

    /** 저장까지 마친 뒤 storedId 를 붙인 사본을 만든다(record 라 사본 생성). */
    public FileValidationResponse withStoredId(String storedId) {
        return new FileValidationResponse(allowed, reason, extension, detectedSignature, storedId);
    }
}

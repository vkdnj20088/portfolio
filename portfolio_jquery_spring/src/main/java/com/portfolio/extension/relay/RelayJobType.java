package com.portfolio.extension.relay;

/**
 * 작업 유형 - 유한 집합의 코드. 표시 이름("결제 승인 통보" 등)은 클라이언트 카탈로그
 * (relayMessages.ts)가 조립한다. 서버는 어떤 언어의 문장도 만들지 않는다(i18n 사전 조치).
 */
public enum RelayJobType {
    PAYMENT_NOTIFY,
    RECEIPT_EMAIL,
    WEBHOOK_PUSH,
    SEARCH_INDEX_SYNC
}

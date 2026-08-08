package com.portfolio.extension.relay;

/**
 * 시도 실패 사유 코드. 서버는 이 enum 만 내려보내고 <b>표시 문자열은 클라이언트가 조립</b>한다
 * (frontend/src/lib/relayMessages.ts). 서버가 한국어 문장을 만들면 현지화(i18n) 라운드에서
 * 서버가 로케일을 알아야 하는 구조가 된다 - 코드+파라미터만 내려보내는 것이 그 사전 조치다.
 */
public enum RelayErrorCode {
    UPSTREAM_TIMEOUT,
    UPSTREAM_5XX,
    UPSTREAM_CONN_RESET
}

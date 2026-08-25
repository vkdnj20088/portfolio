package com.portfolio.extension.relay;

/**
 * 워커 리스가 어느 층의 방어에 기대는가. 기본값은 {@link #SKIP_LOCKED} 이고 운영은 이것만 쓴다.
 *
 * <p>나머지 둘은 <b>실험용</b>이다. "행 잠금이 필요하다"는 주장을 글로만 두면 검증되지 않으므로,
 * 층을 하나씩 걷어내고 무슨 일이 벌어지는지 실제로 돌려 보기 위해 남긴 스위치다.
 * 문서 QA 의 가드 대조, 이중 승인 실험대의 방어선 토글과 같은 장치이고, 같은 이유로 기본값은
 * 아무것도 바뀌지 않는다 - 켜지 않으면 존재하지 않는 것과 같다.
 *
 * <p>세 층의 관계가 이 스위치로 드러난다. 아래로 갈수록 상위 층이 사라지고, 그때 무엇이
 * 대신 잡는지가 실측 대상이다.
 * <ol>
 *   <li>{@code SKIP_LOCKED} - 행 잠금으로 애초에 겹치지 않는다(비차단).</li>
 *   <li>{@code FOR_UPDATE} - 여전히 겹치지 않지만 <b>기다린다</b>. 정확성이 아니라 처리량 문제다.</li>
 *   <li>{@code NONE} - 잠금이 없다. 둘이 같은 행을 집고, 낙관적 락(version)과
 *       {@code UNIQUE(job_id, run, attempt_no)} 가 마지막 방어선이 된다.</li>
 * </ol>
 */
public enum RelayLeaseMode {
    SKIP_LOCKED,
    FOR_UPDATE,
    NONE
}

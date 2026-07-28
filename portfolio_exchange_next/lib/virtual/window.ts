// 리스트 가상화(windowing)의 핵심 순수 계산 - 스크롤 위치로부터 "지금 그릴 행 구간"을 구한다.
// 외부 라이브러리 없이, 고정 행 높이를 전제로 O(1) 로 가시 구간 + 위/아래 스페이서 높이를 낸다.
// 이 함수가 순수하므로 경계(맨 위/맨 아래/빈 목록/오버스캔)를 단위 테스트로 못박을 수 있다.
export interface WindowInput {
  scrollTop: number; // 스크롤 컨테이너의 현재 scrollTop(px)
  viewportH: number; // 보이는 영역 높이(px)
  rowH: number; // 고정 행 높이(px)
  total: number; // 전체 행 수
  overscan: number; // 가시 구간 위/아래로 더 그릴 여유 행 수(스크롤 시 흰 줄 방지)
}

export interface WindowOut {
  start: number; // 렌더 시작 인덱스(포함)
  end: number; // 렌더 끝 인덱스(제외)
  padTop: number; // 위 스페이서 높이(px) = 전체 스크롤 높이 보존
  padBottom: number; // 아래 스페이서 높이(px)
}

export function computeWindow({ scrollTop, viewportH, rowH, total, overscan }: WindowInput): WindowOut {
  if (total <= 0 || rowH <= 0) return { start: 0, end: 0, padTop: 0, padBottom: 0 };
  const clampedTop = Math.max(0, Math.min(scrollTop, Math.max(0, total * rowH - viewportH)));
  const first = Math.floor(clampedTop / rowH);
  const visible = Math.ceil(viewportH / rowH);
  const start = Math.max(0, first - overscan);
  const end = Math.min(total, first + visible + overscan);
  return { start, end, padTop: start * rowH, padBottom: (total - end) * rowH };
}

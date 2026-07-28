/*
 * IP 어드민 프론트의 순수 조회 헬퍼(#O4) - DOM/jQuery 와 무관하게 뽑아 단위 테스트로 못박는다.
 * (백엔드는 128개로 촘촘한데 프론트는 0이던 "테스트 절벽"을 닫는 조각.)
 *
 * 시간 규약: datetime-local 입력값(TZ 없는 로컬 벽시계)을 브라우저 디바이스 TZ 로 해석해
 * epoch millis / ISO-8601 UTC 로 변환한다. 서버는 millis(검색 하한/상한)와 ISO(본문)를 각각 받는다.
 */

/** datetime-local 값(디바이스 TZ) -> epoch millis. 빈 값/파싱 실패는 null. */
export function localToMillis(v: string): number | null {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
}

/** datetime-local 값 -> ISO-8601 UTC 문자열(본문 전송용). 빈 값/파싱 실패는 null. */
export function localToIso(v: string): string | null {
  const ms = localToMillis(v);
  return ms == null ? null : new Date(ms).toISOString();
}

export interface QueryInput {
  q?: string;
  startLocal?: string;
  endLocal?: string;
  cursor?: string | null;
  pageSize: number;
}

/**
 * 목록 조회 쿼리 파라미터 조립(키셋). 빈 값은 파라미터에서 빠지고, 시각은 millis 로 변환한다.
 * DOM 을 읽지 않으므로(값을 인자로 받음) 조합 규칙만 순수하게 검증할 수 있다.
 */
export function buildQuery(input: QueryInput): Record<string, string> {
  const out: Record<string, string> = { size: String(input.pageSize) };
  const qv = (input.q ?? '').trim();
  if (qv) out.q = qv;
  const sf = localToMillis(input.startLocal ?? '');
  if (sf != null) out.startFrom = String(sf);
  const et = localToMillis(input.endLocal ?? '');
  if (et != null) out.endTo = String(et);
  if (input.cursor) out.cursor = input.cursor;
  return out;
}

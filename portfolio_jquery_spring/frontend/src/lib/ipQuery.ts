/*
 * IP 어드민 프론트의 순수 조회 헬퍼(#O4) - DOM/jQuery 와 무관하게 뽑아 단위 테스트로 못박는다.
 * (백엔드는 128개로 촘촘한데 프론트는 0이던 "테스트 절벽"을 닫는 조각.)
 *
 * 시간 규약: datetime-local 값(TZ 없는 벽시계)을 **접속 기기의 시간대**로 해석해 epoch millis /
 * ISO-8601 UTC 로 변환한다. 서버는 millis(검색 하한/상한)와 ISO(본문)를 각각 받고 저장은
 * `Instant`(UTC 절대 시점)다 - 변환이 클라이언트 한 곳에만 있어 서버 TZ 와 무관하다.
 *
 * 왜 기기 TZ 인가: 표시(ip.ts fmt)도 기기 TZ 이므로 입력과 표시가 같은 기준이다 - 화면에 09:00
 * 으로 보이던 값을 그대로 다시 넣으면 같은 시점이 저장된다. "이 IP 가 몇 시부터 열려 있나"는
 * 보는 사람의 시계로 답해야 하는 질문이고, 절대 시점으로 저장해 두었기 때문에 같은 한 행을
 * 사람마다 자기 시각으로 읽을 수 있다.
 */

/**
 * datetime-local 이 낼 수 있는 형태. 초/밀리초는 브라우저와 step 설정에 따라 붙거나 빠진다.
 *
 * 파싱은 브라우저에 맡기고 이 정규식은 **형태 검사**만 한다. 검사가 필요한 이유는 날짜만 있는
 * 문자열(`2024-06-01`)을 JS 가 <b>UTC</b> 로 읽고 날짜+시각(`2024-06-01T09:00`)은 <b>지역
 * 시간</b>으로 읽기 때문이다 - 한 함수에 넣었는데 기준이 갈리는 유명한 함정이다. 시각 부분을
 * 필수로 요구해 그 갈림길에 아예 들어가지 않는다.
 */
const LOCAL_DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/;

/**
 * datetime-local 값(기기 TZ 벽시계) -> epoch millis. 빈 값/형태 불일치는 null.
 *
 * TZ 가 없는 날짜+시각 문자열을 JS 는 지역 시간으로 읽는다 - 여기서는 그 기본 동작이 정확히
 * 원하는 해석이라 오프셋을 손으로 더하지 않는다. 직접 계산하면 서머타임 경계에서 틀리는데
 * (전환일의 오프셋은 그날 몇 시냐에 따라 달라진다) 브라우저는 IANA 규칙으로 맞게 읽는다.
 */
export function localToMillis(v: string): number | null {
  if (!LOCAL_DATETIME.test(v)) return null;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * epoch millis -> datetime-local 입력값(기기 TZ 벽시계). 화면 값을 폼에 되돌릴 때 쓴다.
 * 지역 시간 getter 로 조립하므로 localToMillis 의 역함수다(분 단위까지 왕복 보존).
 */
export function millisToLocal(ms: number): string {
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    + `T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** datetime-local 값 -> ISO-8601 UTC 문자열(본문 전송용). 빈 값/형태 불일치는 null. */
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

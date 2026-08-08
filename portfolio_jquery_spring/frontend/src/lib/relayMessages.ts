/**
 * 작업 릴레이 화면의 표시 문자열 카탈로그 + 순수 표시 헬퍼.
 *
 * 서버는 상태·오류·유형을 enum 코드로만 내려보내고(RelayDtos 참고) 문장은 전부 여기서
 * 조립한다. 문자열을 화면 곳곳에 리터럴로 흩뿌리지 않고 한 파일에 모아 두는 것은 현지화
 * 라운드의 사전 조치다 - 그때 이 파일이 메시지 카탈로그로 승격되면 끝난다.
 *
 * 헬퍼는 DOM 없이 값 -> 문자열만 다루는 순수 함수라 vitest(jsdom 불필요)로 검증한다.
 */

export const STATUS_LABEL: Record<string, string> = {
  PENDING: '대기',
  RUNNING: '실행 중',
  RETRYING: '재시도 대기',
  SUCCEEDED: '완료',
  DEAD_LETTER: '격리(DLQ)',
  CANCELED: '취소됨',
};

export const ERROR_LABEL: Record<string, string> = {
  UPSTREAM_TIMEOUT: '응답 시간 초과',
  UPSTREAM_5XX: '상대 서버 오류(5xx)',
  UPSTREAM_CONN_RESET: '연결 끊김',
};

export const TYPE_LABEL: Record<string, string> = {
  PAYMENT_NOTIFY: '결제 승인 통보',
  RECEIPT_EMAIL: '영수증 메일 발송',
  WEBHOOK_PUSH: '파트너 웹훅 전송',
  SEARCH_INDEX_SYNC: '검색 색인 동기화',
};

export const SCENARIO_LABEL: Record<string, string> = {
  ALWAYS_SUCCEED: '항상 성공',
  THIRD_TIME_LUCKY: '3회째 성공',
  ALWAYS_FAIL: '끝내 실패',
  TIMEOUT_THEN_SUCCEED: '타임아웃 후 성공',
  FLAKY_5XX: '일시적 5xx',
};

/** 서버 결정 코어와 같은 상수 - 화면이 산식을 그릴 때 쓴다(RelayOutcomes 와 정합). */
export const BASE_DELAY_MS = 1_000;
export const CAP_DELAY_MS = 10_000;

/** 1234 -> "1.2s" (표시용 초 단위, 소수 1자리). */
export function fmtSec(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * 백오프 산식 표시: "기저 1s × 2^(n-1) = E, 지터 +J".
 * 표시값과 실행값이 같아야 하므로(제품 결정) 산식은 실제 backoffMs 에서 역산한다 -
 * 지수부를 다시 계산해 지터 = 실제값 - 지수부. 상한에 닿은 경우 그 사실을 그대로 말한다.
 */
export function backoffFormula(attemptNo: number, backoffMs: number): string {
  const exp = Math.min(BASE_DELAY_MS * 2 ** (attemptNo - 1), CAP_DELAY_MS);
  if (backoffMs >= CAP_DELAY_MS) {
    return `상한 ${fmtSec(CAP_DELAY_MS)} 적용`;
  }
  const jitter = Math.max(0, backoffMs - exp);
  return `기저 1s × 2^${attemptNo - 1} = ${fmtSec(exp)}, 지터 +${fmtSec(jitter)}`;
}

/** ISO(UTC) -> 접속 기기 시간대의 "HH:MM:SS.mmm" (IP 화면과 같은 원칙: 표시는 보는 사람 기준). */
export function fmtClock(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

/** 지금부터 다음 시도까지 남은 시간 표기. 이미 지났으면 "곧". */
export function fmtUntil(nextIso: string | null, now: Date = new Date()): string {
  if (!nextIso) return '';
  const diff = new Date(nextIso).getTime() - now.getTime();
  if (diff <= 0) return '곧';
  return `+${fmtSec(diff)}`;
}

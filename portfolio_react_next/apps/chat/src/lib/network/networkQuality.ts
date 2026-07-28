/**
 * 네트워크 "품질" 신호.
 *
 * `navigator.onLine` 은 **끊김만** 알려준다. 게다가 신뢰도가 낮아서, 랜에 연결돼 있으면
 * 인터넷이 죽어도 true 를 반환한다. 실시간 채팅에서 사용자가 실제로 겪는 문제는
 * "끊김"보다 "느리거나 간헐적으로 실패함"에 가깝다.
 *
 * 그래서 요청의 실제 결과(실패/지연)를 API 클라이언트가 여기에 보고하고,
 * 그 관측값으로 '불안정' 상태를 판정한다. 이 모듈은 프레임워크에 의존하지 않는
 * 순수 스토어이고, React 바인딩은 useNetworkStatus 훅이 담당한다.
 */

/** 이 시간(ms)을 넘긴 응답은 '느린 응답'으로 센다. */
const SLOW_THRESHOLD_MS = 3_000;
/** 관측을 유지하는 시간 창(ms). 이 창을 벗어난 기록은 판정에서 제외한다. */
const WINDOW_MS = 20_000;
/** 시간 창 안에서 이 횟수 이상 나쁜 결과가 관측되면 '불안정'으로 본다. */
const UNSTABLE_THRESHOLD = 2;

type Outcome = { at: number; bad: boolean };

let outcomes: Outcome[] = [];
const listeners = new Set<() => void>();
let expiryTimer: ReturnType<typeof setTimeout> | null = null;

function emit() {
  for (const listener of listeners) listener();
}

function prune(now: number) {
  const cutoff = now - WINDOW_MS;
  const next = outcomes.filter((o) => o.at >= cutoff);
  const changed = next.length !== outcomes.length;
  outcomes = next;
  return changed;
}

/**
 * 가장 오래된 '나쁜' 관측이 시간 창을 벗어나는 시점에 한 번 더 알린다.
 *
 * 이 예약이 없으면 유휴 상태에서 배너가 꺼지지 않는다: 관측이 만료돼도
 * 구독자에게 알림이 가지 않으면 useSyncExternalStore 는 스냅샷을 다시 읽지
 * 않아, 다음 요청이 있기 전까지 '불안정' 판정이 화면에 남는다.
 */
function scheduleExpiryCheck() {
  if (expiryTimer) {
    clearTimeout(expiryTimer);
    expiryTimer = null;
  }
  const earliestBad = outcomes.find((o) => o.bad); // 시간순 push 라 첫 항목이 가장 오래됐다
  if (!earliestBad) return;
  const delay = Math.max(0, earliestBad.at + WINDOW_MS - Date.now()) + 50;
  expiryTimer = setTimeout(() => {
    expiryTimer = null;
    prune(Date.now());
    emit(); // 판정이 그대로면 스냅샷이 같아 리렌더가 없다 - 무해한 재확인
    scheduleExpiryCheck(); // 남은 나쁜 관측의 다음 만료를 이어서 예약
  }, delay);
}

/** API 클라이언트가 요청 1건의 결과를 보고한다. */
export function reportRequestOutcome(input: { durationMs: number; ok: boolean }) {
  const now = Date.now();
  prune(now);
  outcomes.push({ at: now, bad: !input.ok || input.durationMs >= SLOW_THRESHOLD_MS });
  emit();
  scheduleExpiryCheck();
}

/** 관측 기록을 비운다(연결이 확실히 회복된 시점 등). */
export function resetNetworkQuality() {
  if (expiryTimer) {
    clearTimeout(expiryTimer);
    expiryTimer = null;
  }
  if (outcomes.length === 0) return;
  outcomes = [];
  emit();
}

/** 최근 시간 창 안에서 불안정으로 판정되는가. */
export function isDegraded(): boolean {
  prune(Date.now());
  return outcomes.filter((o) => o.bad).length >= UNSTABLE_THRESHOLD;
}

export function subscribeNetworkQuality(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

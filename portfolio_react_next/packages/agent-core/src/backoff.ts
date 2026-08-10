import { digest } from './digest';

/**
 * 도구 재시도 대기 시간 - 지수 백오프 + 지터.
 *
 * **재시도는 하네스가 한다. 에이전트에게 맡기지 않는다.** 모델이 재시도를 결정하게 두면
 * 같은 실패에 스텝을 계속 태우다 예산만 태우고 끝난다. 재시도 여부는 도구가 돌려준
 * `retryable` 이 정하고, 언제 다시 부를지는 이 함수가 정한다.
 *
 * 지터가 있으면 보통 재현이 깨지는데, 여기서는 시드 기반 순수 함수라 깨지지 않는다 -
 * 같은 (runId, callId, attempt)면 같은 대기 시간이 나온다. 작업 릴레이 데모에서 "성패와
 * 백오프를 시드 기반 순수 함수로 두어 실패 타임라인을 결정적으로 재생한다"고 한 것과 같은
 * 규약이고, 그래서 커밋된 trace 의 실패 구간이 재생에서도 같은 모양으로 그려진다.
 */
export interface BackoffConfig {
  baseMs: number;
  maxMs: number;
  /** 지터 폭(0~1). 0.2면 기저값의 -20%~+20%. */
  jitterRatio: number;
}

export const DEFAULT_BACKOFF: BackoffConfig = { baseMs: 200, maxMs: 4000, jitterRatio: 0.2 };

/**
 * attempt 는 1부터. 1회차 실패 뒤의 대기가 `attempt=1` 이다.
 * 반환값은 정수 ms 라 화면과 테스트가 같은 값을 본다.
 */
export function backoffDelayMs(
  runId: string,
  callId: string,
  attempt: number,
  cfg: BackoffConfig = DEFAULT_BACKOFF,
): number {
  const exponential = Math.min(cfg.baseMs * 2 ** (attempt - 1), cfg.maxMs);
  // digest 앞 8자리를 0~1 로 편다. 난수원을 따로 두지 않는 이유는 위 주석대로 재현성이다.
  const unit = parseInt(digest([runId, callId, attempt]).slice(0, 8), 16) / 0xffffffff;
  const jitter = (unit * 2 - 1) * cfg.jitterRatio;
  return Math.max(0, Math.round(exponential * (1 + jitter)));
}

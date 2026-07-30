/**
 * 응답 생성 레이트리밋(#C2) - 프로세스 내 토큰 버킷.
 *
 * <h2>왜 토큰 버킷인가</h2>
 * 사람의 대화는 몰아 쓰고 쉬는 모양이다 - 몇 마디 빠르게 던지고 답을 읽는 동안 멈춘다.
 * 고정 윈도(1분에 N건)는 그 모양과 맞지 않고, 경계에서 실제 허용량이 두 배가 된다
 * (59초에 N건 + 61초에 N건 = 2초에 2N건). 토큰 버킷은 버스트를 `capacity` 로,
 * 지속 처리율을 `refillPerSec` 로 각각 정할 수 있어 둘을 섞지 않는다.
 *
 * <h2>프로세스 내 상태의 한계 - 알고 쓴다</h2>
 * 이 배포는 EC2 한 대에서 standalone Next 한 프로세스다. 그래서 프로세스 메모리가 곧 전체
 * 상태이고 이 구현이 정확하다. 인스턴스가 둘 이상이 되면 각 인스턴스가 따로 세므로 실효 한도가
 * 인스턴스 수만큼 늘어난다 - 그때는 Redis 같은 공유 저장소로 옮겨야 하고, 그 교체가 쉽도록
 * 판정 로직을 이 파일 하나에 순수 함수로 모아 두었다(now 주입, 전역 시계 참조 없음).
 * 프로세스가 재시작하면 버킷이 비워지는 것도 같은 성질이다 - 재시작이 한도를 초기화한다.
 *
 * <h2>메모리 상한</h2>
 * IP 별 버킷을 Map 에 쌓으면 방문자 수만큼 자란다. 그래서 (1) 접근할 때마다 오래된 항목을
 * 훑어 지우고 (2) 그래도 상한을 넘으면 가장 오래된 것부터 버린다. 레이트리밋이 메모리 고갈의
 * 원인이 되면 막으려던 것을 스스로 만드는 셈이다.
 */

/** 한 번에 몰아 쓸 수 있는 요청 수. 이 수를 넘겨야 429 가 난다. */
export const BURST_CAPACITY = 5;
/** 지속 처리율(초당 토큰). 5초에 1건 = 버킷을 다 쓰면 25초 뒤 다시 5건이 된다. */
export const REFILL_PER_SEC = 0.2;
/** 이 시간 동안 조용한 버킷은 지운다(가득 찬 버킷은 없는 것과 같다). */
const IDLE_TTL_MS = 10 * 60 * 1000;
/** Map 크기 상한. 넘으면 오래된 것부터 버린다. */
const MAX_BUCKETS = 10_000;

interface Bucket {
  /** 남은 토큰(소수 - 부분 충전을 버리지 않는다). */
  tokens: number;
  /** 마지막 충전 시각(ms). */
  updatedAt: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** 거절일 때만 의미가 있다 - 토큰 1개가 다시 차기까지의 초(올림, 최소 1). */
  retryAfterSeconds: number;
  /** 남은 토큰(내림). 관측/헤더용. */
  remaining: number;
}

/**
 * 토큰 버킷 하나. 서버 전역 상태를 모듈 스코프에 두는 것은 의도적이다 - route handler 는
 * 요청마다 새로 실행되지만 모듈은 프로세스에 한 번만 평가되므로, 여기가 이 프로세스의
 * "공유 상태" 자리다. 테스트는 이 전역을 건드리지 않고 아래 순수 함수를 직접 쓴다.
 */
const buckets = new Map<string, Bucket>();

/**
 * 순수 판정. 버킷 맵과 현재 시각을 인자로 받으므로 시간을 흉내내 결정적으로 테스트할 수 있다.
 *
 * 부작용은 인자로 받은 맵에만 일어난다(전역 참조 없음).
 */
export function consume(
  store: Map<string, Bucket>,
  key: string,
  now: number,
  capacity: number = BURST_CAPACITY,
  refillPerSec: number = REFILL_PER_SEC,
): RateLimitDecision {
  sweep(store, now);

  const existing = store.get(key);
  // 처음 보는 키는 가득 찬 버킷으로 시작한다 - 첫 방문자를 벌하지 않는다.
  const bucket: Bucket = existing ?? { tokens: capacity, updatedAt: now };

  // 경과 시간만큼 충전(상한은 capacity). 시계가 뒤로 갔으면(NTP 보정 등) 충전 0 으로 본다 -
  // 음수 경과를 그대로 곱하면 토큰이 줄어들어, 시계 보정이 사용자 차단으로 바뀐다.
  const elapsedSec = Math.max(0, now - bucket.updatedAt) / 1000;
  bucket.tokens = Math.min(capacity, bucket.tokens + elapsedSec * refillPerSec);
  bucket.updatedAt = now;

  let decision: RateLimitDecision;
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    decision = { allowed: true, retryAfterSeconds: 0, remaining: Math.floor(bucket.tokens) };
  } else {
    // 토큰 1개가 차기까지 남은 시간. 올림 + 최소 1 - Retry-After: 0 은 "지금 다시" 라는 뜻이라
    // 방금 거절한 클라이언트를 곧바로 되돌려보내 거절이 반복된다.
    const needSec = (1 - bucket.tokens) / refillPerSec;
    decision = {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil(needSec)),
      remaining: 0,
    };
  }

  // 거절도 기록한다 - 거절된 요청이 상태를 남기지 않으면 다음 요청이 다시 "처음 보는 키"가 되어
  // 가득 찬 버킷을 받는다(한도가 사실상 사라진다).
  store.set(key, bucket);
  return decision;
}

/** 오래된 버킷 정리 + 상한 초과 시 오래된 것부터 버린다. */
function sweep(store: Map<string, Bucket>, now: number): void {
  for (const [key, bucket] of store) {
    if (now - bucket.updatedAt > IDLE_TTL_MS) store.delete(key);
  }
  if (store.size <= MAX_BUCKETS) return;
  // Map 은 삽입 순서를 지키지만 set 으로 갱신해도 순서가 바뀌지 않으므로, 삽입 순서가 곧
  // "처음 본 순서"다. 정확한 LRU 가 아니라 상한을 지키는 것이 목적이라 이 근사로 충분하다.
  const overflow = store.size - MAX_BUCKETS;
  let removed = 0;
  for (const key of store.keys()) {
    store.delete(key);
    if (++removed >= overflow) break;
  }
}

/**
 * 요청에서 레이트리밋 키를 뽑는다.
 *
 * `X-Forwarded-For` 를 신뢰하는 근거: 이 서비스의 엣지 nginx 가 XFF 를 이어 붙이지 않고
 * `$remote_addr` 로 **덮어쓴다**(infra/nginx/snippets/proxy-app.conf). 즉 앱에 도착한 XFF 는
 * 클라이언트가 보낸 값이 아니라 엣지가 관측한 실제 주소다. 이어 붙이는 기본형이면 클라이언트가
 * 앞쪽에 아무 값이나 넣어 키를 마음대로 바꿀 수 있으므로 이 신뢰는 성립하지 않는다.
 *
 * 헤더가 없으면(로컬 개발 - nginx 가 없다) 단일 키로 모은다. 개발 중에 한도를 재현할 수 있어야
 * 하므로 무제한으로 열지 않는다.
 */
export function clientKey(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (!xff) return 'local';
  // 덮어쓰기 정책이라 보통 한 개지만, 형태가 목록이므로 첫 항목만 쓴다.
  return xff.split(',')[0]?.trim() || 'local';
}

/** route handler 용 - 프로세스 전역 버킷에 대고 판정한다. */
export function checkRateLimit(req: Request, now: number = Date.now()): RateLimitDecision {
  return consume(buckets, clientKey(req), now);
}

/** 테스트/개발용 - 전역 버킷을 비운다. */
export function resetRateLimit(): void {
  buckets.clear();
}

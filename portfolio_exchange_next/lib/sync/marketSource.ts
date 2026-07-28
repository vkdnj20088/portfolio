"use client";
import { useSyncExternalStore } from "react";
import { mockEngine } from "../mock/stream";
import { hashSeed } from "../rng";
import { LeaderElection } from "./leaderElection";
import type { MarketSnapshot } from "../mock/data";

// 멀티탭 시세 동기(#E8). 탭 전역 싱글턴이 useMarketFeed 의 소스가 된다(mockEngine 을 직접 구독하던 자리).
//  - 리더/솔로: mockEngine 을 돌려 스냅샷을 구독자에게 주고, 다른 탭이 있으면 BroadcastChannel 로 방송.
//  - 팔로워: 자기 엔진을 멈추고 리더가 방송한 스냅샷만 반영(같은 시세를 같은 위상으로 공유).
//  - 폴백: BroadcastChannel 미지원이면 항상 솔로(각 탭이 자기 엔진 - 기존 동작과 동일, 회귀 0).
// mockEngine 은 심볼 시드라 결정적이므로, 동기화는 "여러 탭의 위상을 하나로" 맞추는 역할이다.

export type TabRole = "solo" | "leader" | "follower";

const CHANNEL = "jc-exchange-market-sync";
const HEARTBEAT_MS = 700;
const PEER_TIMEOUT_MS = 2200; // 하트비트 3회 누락 ~= 리더 탭 종료로 간주
// 팔로워 폴백 grace: 리더가 "이 마켓"을 구동하지 않는 배치(리더가 비-마켓 페이지거나 다른 마켓)면
// 방송이 아예 안 온다 -> 이 시간(엔진 틱 600ms 의 2배+여유)을 넘겨 끊기면 팔로워가 자기 엔진으로
// 폴백해 프리즈를 막는다. 동일 마켓이면 방송이 600ms 마다 와 grace 안에 갱신되므로 폴백은 미발동.
const FALLBACK_GRACE_MS = 1500;

type Msg =
  | { type: "hello" | "heartbeat" | "bye"; id: string }
  | { type: "snapshot"; id: string; market: string; snapshot: MarketSnapshot };

type Listener = (s: MarketSnapshot) => void;

class MarketSource {
  private readonly selfId = makeId();
  private readonly election = new LeaderElection({ selfId: this.selfId, peerTimeoutMs: PEER_TIMEOUT_MS });
  private channel: BroadcastChannel | null = null;
  private started = false;
  private role: TabRole = "solo";

  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly last = new Map<string, MarketSnapshot>();
  private readonly engineUnsub = new Map<string, () => void>();
  // 마켓별 "마지막으로 리더 방송을 받은 시각"(폴백 grace 판정용). 팔로워 자기 엔진 출력은 여기 갱신하지
  // 않는다 - 그러면 폴백 중 항상 fresh 로 보여 매 tick on/off 플랩이 나기 때문. 오직 방송 수신 + 구독 시작만.
  private readonly lastBroadcastAt = new Map<string, number>();
  private readonly roleListeners = new Set<() => void>();

  /** useMarketFeed 가 호출 - mockEngine.subscribe 와 동일 계약(SSR 가드 포함). */
  subscribe(market: string, cb: Listener): () => void {
    if (typeof window === "undefined") return () => {};
    this.ensureStarted();
    let set = this.listeners.get(market);
    if (!set) {
      set = new Set();
      this.listeners.set(market, set);
    }
    set.add(cb);
    // 구독 시작에 grace 시계를 건다 - 리더 방송이 grace 안에 오면 폴백 없이 방송 위상으로 동기,
    // 안 오면(리더 미구동) grace 후 자기 엔진 폴백. 초기엔 last 스냅샷을 잠깐 보여준 뒤 살아난다.
    if (!this.lastBroadcastAt.has(market)) this.lastBroadcastAt.set(market, Date.now());
    const cur = this.last.get(market);
    if (cur) cb(cur); // 신규 구독자에게 마지막 스냅샷 즉시 제공
    this.updateEngineFor(market);
    return () => {
      set!.delete(cb);
      if (set!.size === 0) {
        this.listeners.delete(market);
        this.stopEngine(market);
      }
    };
  }

  /** 역할 변경 구독(useSyncExternalStore 용 - 인자 없는 알림). */
  onRoleChange(cb: () => void): () => void {
    this.roleListeners.add(cb);
    return () => this.roleListeners.delete(cb);
  }

  getRole(): TabRole {
    return this.role;
  }

  // ── 내부 ──────────────────────────────────────────────────────────────

  private ensureStarted(): void {
    if (this.started) return;
    this.started = true;
    if (typeof BroadcastChannel === "undefined") return; // 폴백: 솔로 유지
    this.channel = new BroadcastChannel(CHANNEL);
    this.channel.onmessage = (e: MessageEvent<Msg>) => this.onMessage(e.data);
    this.post({ type: "hello", id: this.selfId });
    window.setInterval(() => this.tick(), HEARTBEAT_MS);
    window.addEventListener("pagehide", () => this.post({ type: "bye", id: this.selfId }));
  }

  private tick(): void {
    this.post({ type: "heartbeat", id: this.selfId });
    this.reconcileRole(); // 하트비트 타임아웃으로 죽은 리더 감지 -> 재선출
    // 팔로워는 매 tick 방송 신선도를 재평가한다: 방송이 grace 넘게 끊기면 폴백 엔진 시작,
    // 방송이 다시 오면(fresh) 폴백 정지하고 리더 위상으로 재수렴. (역할 무변경이라 reconcileRole 만으론 미평가.)
    if (this.role === "follower") {
      for (const market of this.listeners.keys()) this.updateEngineFor(market);
    }
  }

  private onMessage(msg: Msg): void {
    if (!msg || msg.id === this.selfId) return;
    const now = Date.now();
    if (msg.type === "hello" || msg.type === "heartbeat") {
      this.election.seen(msg.id, now);
      if (msg.type === "hello") this.post({ type: "heartbeat", id: this.selfId }); // 새 탭에 즉답
    } else if (msg.type === "bye") {
      this.election.remove(msg.id);
    } else if (msg.type === "snapshot" && this.role === "follower") {
      this.lastBroadcastAt.set(msg.market, now); // 방송 신선도 갱신 -> 폴백 엔진 정지 근거
      this.last.set(msg.market, msg.snapshot);
      this.listeners.get(msg.market)?.forEach((l) => l(msg.snapshot));
    }
    this.reconcileRole();
  }

  private reconcileRole(): void {
    const now = Date.now();
    const role: TabRole = !this.election.hasPeers(now)
      ? "solo"
      : this.election.isLeader(now)
        ? "leader"
        : "follower";
    if (role === this.role) return;
    this.role = role;
    for (const market of this.listeners.keys()) this.updateEngineFor(market); // 역할 따라 엔진 재조정
    this.roleListeners.forEach((l) => l());
  }

  // 리더/솔로면 엔진 구동(+방송). 팔로워는 평소 정지(수신만)하되, 리더 방송이 grace 넘게 끊기면
  // (리더가 이 마켓 미구동) 자기 엔진으로 폴백해 프리즈를 막는다. 방송 재개 시 다음 tick 에서 정지.
  private updateEngineFor(market: string): void {
    const hasListeners = (this.listeners.get(market)?.size ?? 0) > 0;
    const broadcastStale = Date.now() - (this.lastBroadcastAt.get(market) ?? 0) > FALLBACK_GRACE_MS;
    const shouldRun = hasListeners && (this.role !== "follower" || broadcastStale);
    if (shouldRun && !this.engineUnsub.has(market)) {
      const unsub = mockEngine.subscribe(market, (snap) => {
        this.last.set(market, snap);
        this.listeners.get(market)?.forEach((l) => l(snap));
        if (this.role === "leader") this.post({ type: "snapshot", id: this.selfId, market, snapshot: snap });
      });
      this.engineUnsub.set(market, unsub);
    } else if (!shouldRun) {
      this.stopEngine(market);
    }
  }

  private stopEngine(market: string): void {
    const u = this.engineUnsub.get(market);
    if (u) {
      u();
      this.engineUnsub.delete(market);
    }
  }

  private post(msg: Msg): void {
    this.channel?.postMessage(msg);
  }
}

// 탭마다 유일한 id - 시드 해시 기반(추측/충돌 회피용 임의 문자열).
function makeId(): string {
  let s = "";
  for (let i = 0; i < 3; i++) s += hashSeed(String(performance.now()) + i).toString(36);
  return s;
}

export const marketSource = new MarketSource();

/** 이 탭의 동기화 역할(solo/leader/follower)을 구독하는 훅. SSR 스냅샷은 solo. */
export function useTabRole(): TabRole {
  return useSyncExternalStore(
    (cb) => marketSource.onRoleChange(cb),
    () => marketSource.getRole(),
    () => "solo",
  );
}

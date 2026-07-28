import { describe, expect, it } from "vitest";
import { LeaderElection } from "./leaderElection";

const opts = (selfId: string) => ({ selfId, peerTimeoutMs: 1000 });

describe("LeaderElection - 멀티탭 리더 선출", () => {
  it("단독 탭은 자신이 리더", () => {
    const e = new LeaderElection(opts("b"));
    expect(e.isLeader(0)).toBe(true);
    expect(e.hasPeers(0)).toBe(false);
  });

  it("가장 작은 id 가 리더(결정적)", () => {
    const e = new LeaderElection(opts("m"));
    e.seen("a", 0); // 더 작은 id 존재
    e.seen("z", 0);
    expect(e.leader(0)).toBe("a");
    expect(e.isLeader(0)).toBe(false); // m 은 리더 아님
    expect(e.hasPeers(0)).toBe(true);
  });

  it("자신이 최소면 리더", () => {
    const e = new LeaderElection(opts("a"));
    e.seen("m", 0);
    e.seen("z", 0);
    expect(e.isLeader(0)).toBe(true);
  });

  it("타임아웃 지난 peer 는 죽은 것으로 제외 -> 리더 재선출", () => {
    const e = new LeaderElection(opts("m"));
    e.seen("a", 0); // a 가 리더였음
    expect(e.leader(0)).toBe("a");
    // 1000ms 넘게 소식 없으면 a 는 사망 -> m 이 리더로 승격
    expect(e.leader(1001)).toBe("m");
    expect(e.isLeader(1001)).toBe(true);
  });

  it("하트비트를 갱신하면 계속 살아있음", () => {
    const e = new LeaderElection(opts("m"));
    e.seen("a", 0);
    e.seen("a", 900); // 갱신
    expect(e.leader(1500)).toBe("a"); // 900 기준 1500-900=600 <= 1000, 생존
  });

  it("명시적 이탈(remove)은 즉시 제외", () => {
    const e = new LeaderElection(opts("m"));
    e.seen("a", 0);
    e.remove("a");
    expect(e.isLeader(0)).toBe(true);
  });

  it("자기 자신의 하트비트는 무시(peer 로 안 잡음)", () => {
    const e = new LeaderElection(opts("m"));
    e.seen("m", 0);
    expect(e.hasPeers(0)).toBe(false);
  });
});

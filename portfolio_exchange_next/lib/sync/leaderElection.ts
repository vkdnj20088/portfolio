// 멀티탭 리더 선출(순수) - 여러 탭 중 하나만 시세 엔진을 돌리고 나머지는 그 결과를 받게 하기 위한
// 선출 규칙. 시계를 읽지 않고 호출자가 넘긴 now 로만 판정해 테스트로 못박을 수 있다.
//
// 규칙: 살아있는(최근 하트비트를 받은) 탭 중 id 가 가장 작은(사전순) 탭이 리더.
// 결정적이고 분할뇌(split-brain)를 피한다 - 모두 같은 peer 집합을 보면 같은 리더를 고른다.
export interface ElectionOptions {
  selfId: string;
  peerTimeoutMs: number; // 이 시간 넘게 소식 없는 peer 는 죽은 것으로 간주(리더 탭 종료 감지)
}

export class LeaderElection {
  private readonly selfId: string;
  private readonly peerTimeoutMs: number;
  private readonly lastSeen = new Map<string, number>();

  constructor(opts: ElectionOptions) {
    this.selfId = opts.selfId;
    this.peerTimeoutMs = opts.peerTimeoutMs;
  }

  /** peer 의 하트비트 수신 기록. */
  seen(peerId: string, now: number): void {
    if (peerId !== this.selfId) this.lastSeen.set(peerId, now);
  }

  /** peer 명시적 이탈(BYE) 처리. */
  remove(peerId: string): void {
    this.lastSeen.delete(peerId);
  }

  /** 현재 살아있는 탭 id 목록(자신 포함). */
  alivePeers(now: number): string[] {
    const alive = [this.selfId];
    for (const [id, t] of this.lastSeen) {
      if (now - t <= this.peerTimeoutMs) alive.push(id);
    }
    return alive;
  }

  /** 현재 리더 id = 살아있는 탭 중 사전순 최소. */
  leader(now: number): string {
    return this.alivePeers(now).sort()[0];
  }

  /** 자신이 리더인가. */
  isLeader(now: number): boolean {
    return this.leader(now) === this.selfId;
  }

  /** 자신 외 살아있는 peer 가 있는가(없으면 '단독' 탭). */
  hasPeers(now: number): boolean {
    return this.alivePeers(now).length > 1;
  }
}

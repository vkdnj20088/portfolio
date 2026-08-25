import type { MemoryStore } from './store';
import type { ApprovalEvent, ApprovalEventType } from './types';

/**
 * 아웃박스를 소비하는 팀별 소비자. 정산·상담이 같은 결제 이벤트를 각자 다른 목적으로 본다.
 *
 * 소비자를 늘리는 비용이 "커서 하나 추가"인 것이 큐를 쓰지 않기로 한 근거의 핵심이다.
 * 각자 커서를 들고 있으므로 한 팀이 느리거나 멈춰도 다른 팀의 소비에 영향이 없고,
 * 이력을 전량 보존하기 때문에 나중에 붙는 팀도 과거 전체를 처음부터 다시 읽을 수 있다.
 */
export class EventConsumer {
  private cursor = 0;
  /** 이 소비자가 지금까지 받은 이벤트. 실제 팀이라면 여기서 자기 업무를 한다. */
  readonly received: ApprovalEvent[] = [];

  constructor(
    readonly name: string,
    private store: MemoryStore,
    private interestedIn: readonly ApprovalEventType[],
  ) {}

  poll(): ApprovalEvent[] {
    const batch = this.store.readEventsAfter(this.cursor, this.interestedIn);
    // 처리를 먼저 하고 커서를 나중에 전진시킨다. 순서를 반대로 하면 처리 도중 죽었을 때
    // 그 이벤트를 영영 못 보는 at-most-once 가 되고, 이 설계가 내건 at-least-once 약속이
    // 깨진다. 대신 같은 이벤트를 두 번 받을 수 있으므로 소비자 쪽 처리가 멱등해야 한다.
    this.received.push(...batch);
    const last = batch.at(-1);
    if (last) this.cursor = Math.max(this.cursor, last.seq);
    return batch;
  }
}

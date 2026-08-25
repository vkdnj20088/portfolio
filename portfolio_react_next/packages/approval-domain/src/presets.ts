import { ALL_GUARDS_ON, type GuardConfig } from './guards';
import { DEFAULT_LAB_CONFIG, type LabConfig } from './lab';
import type { ApprovalStatus } from './types';

export type PresetId = 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6';
export type PresetSide = 'off' | 'on';

/** 실행 전에 적어 두는 기대값. 실행이 이 값과 다르면 시험이 깨진다 - 화면의 숫자도 여기서 검증된다. */
export interface LabExpectation {
  approvedAtPg: number;
  approveCalls: number;
  requests: number;
  /** 첫 번째 결제 요청의 최종 상태. */
  finalStatus: ApprovalStatus;
}

export interface PresetSideSpec {
  label: string;
  /** 이 쪽이 무엇을 말하는가. 숫자만 두면 어느 쪽이 틀린 건지 화면에서 안 읽힌다. */
  verdict: string;
  config: LabConfig;
  expect: LabExpectation;
}

export interface Preset {
  id: PresetId;
  title: string;
  /** 무슨 상황인가. */
  situation: string;
  /** 이 대조가 증명하는 한 문장. */
  proves: string;
  off: PresetSideSpec;
  on: PresetSideSpec;
}

function guards(off: Partial<Record<keyof GuardConfig, true>> = {}): GuardConfig {
  return {
    idempotencyKey: !off.idempotencyKey,
    claimTransition: !off.claimTransition,
    reconcileQuery: !off.reconcileQuery,
    attemptLimit: !off.attemptLimit,
  };
}

function config(partial: Partial<LabConfig>): LabConfig {
  return { ...DEFAULT_LAB_CONFIG, guards: ALL_GUARDS_ON, ...partial };
}

/**
 * 프리셋 여섯. 짝수는 없다 - 하나하나가 "이렇게 하면 되지 않나"라는 그럴듯한 오답과
 * 짝지어져 있고, 그 오답을 실제로 실행해서 숫자로 틀렸음을 보이는 것이 이 화면의 값이다.
 *
 * 특히 P2 와 P6 이 그렇다. 나머지는 방어선이 있다/없다의 대조지만, 이 둘은 **성실하게
 * 짠 코드가 내는 오답**이다 - timeout 을 실패로 보고 포기하는 것도, 죽은 워커의 작업을
 * 처음으로 되돌리는 것도 그 자체로는 합리적으로 보인다.
 */
export const PRESETS: Preset[] = [
  {
    id: 'P1',
    title: '응답 유실 후 재시도',
    situation: 'PG 는 승인을 마쳤는데 그 응답만 우리에게 오지 않았다. 다음 주기에 재시도한다.',
    proves: 'timeout 은 실패가 아니다. 실패로 보고 다시 보내면 같은 결제가 두 번 청구된다.',
    off: {
      label: '대사 끔 · 실패로 보고 재시도',
      verdict: '같은 결제가 두 번 승인됐다. 고객 카드에 두 번 찍힌다.',
      config: config({
        approverMode: 'timeout_after_approve',
        approverRecoversAtTick: 2,
        guards: guards({ reconcileQuery: true }),
        unknownFallback: 'retry',
        ticks: 3,
      }),
      expect: { approvedAtPg: 2, approveCalls: 2, requests: 1, finalStatus: 'APPROVED' },
    },
    on: {
      label: '대사 켬',
      verdict: '조회가 이미 승인됐음을 확인해 재전송하지 않았다.',
      config: config({
        approverMode: 'timeout_after_approve',
        approverRecoversAtTick: 2,
        ticks: 3,
      }),
      expect: { approvedAtPg: 1, approveCalls: 1, requests: 1, finalStatus: 'APPROVED' },
    },
  },
  {
    id: 'P2',
    title: '승인 전 끊김',
    situation: '증상은 P1 과 똑같은 timeout 인데, PG 쪽 사실은 반대다 - 승인이 나가지 않았다.',
    proves: '반대로 뭉개도 틀린다. 실패로 보고 포기하면 정상 처리될 수 있었던 결제를 잃는다.',
    off: {
      label: '대사 끔 · 실패로 보고 포기',
      verdict: '승인 0건. 이중 청구는 없지만 결제 자체가 사라졌다.',
      config: config({
        approverMode: 'timeout_before_approve',
        approverRecoversAtTick: 2,
        guards: guards({ reconcileQuery: true }),
        unknownFallback: 'abandon',
        ticks: 3,
      }),
      expect: { approvedAtPg: 0, approveCalls: 1, requests: 1, finalStatus: 'APPROVAL_FAILED' },
    },
    on: {
      label: '대사 켬',
      verdict: '조회가 미승인을 확인한 뒤에야 재전송했다.',
      config: config({
        approverMode: 'timeout_before_approve',
        approverRecoversAtTick: 2,
        ticks: 3,
      }),
      expect: { approvedAtPg: 1, approveCalls: 2, requests: 1, finalStatus: 'APPROVED' },
    },
  },
  {
    id: 'P3',
    title: '워커 두 대가 동시에',
    situation: '처리기를 두 대 띄웠다. 둘 다 같은 결제 요청을 집는다.',
    proves: '방어선의 위치는 저장소다. 워커 안의 메모리로 막으면 두 대일 때 없는 것과 같다.',
    off: {
      label: '조건부 전이 끔',
      verdict: '두 워커가 모두 통과해 승인이 두 번 나갔다.',
      config: config({ workers: 2, guards: guards({ claimTransition: true }), ticks: 1 }),
      expect: { approvedAtPg: 2, approveCalls: 2, requests: 1, finalStatus: 'APPROVED' },
    },
    on: {
      label: '조건부 전이 켬',
      verdict: '한 대만 클레임에 성공했다. 진 쪽은 오류가 아니라 건너뜀으로 기록된다.',
      config: config({ workers: 2, ticks: 1 }),
      expect: { approvedAtPg: 1, approveCalls: 1, requests: 1, finalStatus: 'APPROVED' },
    },
  },
  {
    id: 'P4',
    title: '더블클릭',
    situation: '결제 버튼이 두 번 눌렸다. 같은 멱등키로 접수가 두 번 들어온다.',
    proves:
      '진입점에서 걸러야 하는 중복이 있다. 여기를 놓치면 아래 방어선은 서로 다른 결제로 본다.',
    off: {
      label: '멱등키 끔',
      verdict: '결제 요청이 두 건 생겼다. 아래 방어선들은 정상 동작했는데도 두 번 승인된다.',
      config: config({ doubleSubmit: true, guards: guards({ idempotencyKey: true }), ticks: 1 }),
      expect: { approvedAtPg: 2, approveCalls: 2, requests: 2, finalStatus: 'APPROVED' },
    },
    on: {
      label: '멱등키 켬',
      verdict: '두 번째 접수는 같은 요청을 돌려줬다.',
      config: config({ doubleSubmit: true, ticks: 1 }),
      expect: { approvedAtPg: 1, approveCalls: 1, requests: 1, finalStatus: 'APPROVED' },
    },
  },
  {
    id: 'P5',
    title: '연결 실패가 계속될 때',
    situation: 'PG 로 연결 자체가 되지 않는다. 미승인은 확실하므로 재전송은 안전하다.',
    proves: '안전하다고 해서 끝없이 보내도 되는 것은 아니다. 실패의 끝을 정의해야 한다.',
    off: {
      label: '상한 끔',
      verdict: '주기마다 계속 다시 보낸다. 아무도 이 결제가 멈췄다는 것을 모른다.',
      config: config({
        approverMode: 'down',
        guards: guards({ attemptLimit: true }),
        ticks: 6,
      }),
      expect: { approvedAtPg: 0, approveCalls: 6, requests: 1, finalStatus: 'RECEIVED' },
    },
    on: {
      label: '상한 켬',
      verdict: '세 번에서 멈추고 격리했다. 왜 멈췄는지가 이력에 남는다.',
      config: config({ approverMode: 'down', ticks: 6 }),
      expect: { approvedAtPg: 0, approveCalls: 3, requests: 1, finalStatus: 'APPROVAL_FAILED' },
    },
  },
  {
    id: 'P6',
    title: '워커가 죽은 뒤의 회수',
    situation:
      '워커가 승인 요청을 보낸 직후, 그 사실을 저장소에 남기기 전에 죽었다. 멈춘 클레임을 회수해야 한다.',
    proves: '그럴듯한 오답. 처음으로 되돌리는 것이 자연스러워 보이지만 그것이 곧 이중 승인이다.',
    off: {
      label: '회수 목적지 = 접수',
      verdict:
        '되돌린 즉시 재승인이 나갔다. 죽은 워커가 이미 보냈다는 사실을 아무도 확인하지 않았다.',
      config: config({
        deadWorkerClaim: true,
        reclaimTo: 'received',
        staleClaimMs: 0,
        ticks: 4,
      }),
      expect: { approvedAtPg: 2, approveCalls: 2, requests: 1, finalStatus: 'APPROVED' },
    },
    on: {
      label: '회수 목적지 = 모름',
      verdict: '모른다고 적어 두고 다음 주기의 조회가 풀었다.',
      config: config({ deadWorkerClaim: true, reclaimTo: 'unknown', staleClaimMs: 0, ticks: 4 }),
      expect: { approvedAtPg: 1, approveCalls: 1, requests: 1, finalStatus: 'APPROVED' },
    },
  },
];

export function presetById(id: PresetId): Preset {
  const found = PRESETS.find((p) => p.id === id);
  if (!found) throw new Error(`알 수 없는 프리셋: ${id}`);
  return found;
}

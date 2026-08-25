import {
  ALL_GUARDS_ON,
  presetById,
  type GuardConfig,
  type LabConfig,
  type PresetId,
  type ReclaimTarget,
  type UnknownFallback,
} from '@chat/approval-domain';

/**
 * 화면이 들고 있는 실험 한 쌍.
 *
 * 두 실행의 **시나리오는 반드시 같아야 한다** - PG 모드나 워커 수가 다르면 그건 대조가
 * 아니라 서로 다른 두 실험이고, 숫자가 갈려도 무엇 때문인지 말할 수 없다. 그래서 시나리오
 * 조작은 양쪽에 같이 적용하고, 방어선·회수 목적지·접는 방향만 끈 쪽에 적용한다.
 * 켠 쪽은 언제나 전부 켜진 상태다.
 */
export interface LabState {
  /** 프리셋에서 왔으면 그 id. 사용자가 손대면 null 이 되고 기대값이 사라진다. */
  presetId: PresetId | null;
  off: LabConfig;
  on: LabConfig;
}

/** 양쪽에 같이 적용되는 것. 여기가 갈리면 대조가 아니게 된다. */
export type ScenarioPatch = Partial<
  Pick<
    LabConfig,
    | 'approverMode'
    | 'workers'
    | 'redeliver'
    | 'doubleSubmit'
    | 'deadWorkerClaim'
    | 'staleClaimMs'
    | 'ticks'
    | 'approverRecoversAtTick'
  >
>;

/** 끈 쪽에만 적용되는 것. */
export interface OffPatch {
  guards?: Partial<GuardConfig>;
  unknownFallback?: UnknownFallback;
  reclaimTo?: ReclaimTarget;
}

export function fromPreset(id: PresetId): LabState {
  const preset = presetById(id);
  return { presetId: id, off: preset.off.config, on: preset.on.config };
}

export function patchScenario(state: LabState, patch: ScenarioPatch): LabState {
  return {
    presetId: null,
    off: { ...state.off, ...patch },
    on: { ...state.on, ...patch },
  };
}

export function patchOff(state: LabState, patch: OffPatch): LabState {
  return {
    presetId: null,
    off: {
      ...state.off,
      guards: { ...state.off.guards, ...patch.guards },
      unknownFallback: patch.unknownFallback ?? state.off.unknownFallback,
      reclaimTo: patch.reclaimTo ?? state.off.reclaimTo,
    },
    // 켠 쪽은 사용자가 무엇을 만지든 전부 켜진 채로 남는다 - 이 쪽이 기준선이다.
    on: { ...state.on, guards: ALL_GUARDS_ON, reclaimTo: 'unknown' },
  };
}

/** 끈 쪽에서 실제로 꺼져 있는 방어선 목록. 하나도 없으면 대조가 성립하지 않는다. */
export function offGuardNames(state: LabState): (keyof GuardConfig)[] {
  const keys: (keyof GuardConfig)[] = [
    'idempotencyKey',
    'claimTransition',
    'reconcileQuery',
    'attemptLimit',
  ];
  return keys.filter((k) => !state.off.guards[k]);
}

/** 끈 쪽과 켠 쪽이 같은 설정인가. 같으면 화면이 대조라고 말하면 안 된다. */
export function isContrastable(state: LabState): boolean {
  return offGuardNames(state).length > 0 || state.off.reclaimTo !== state.on.reclaimTo;
}

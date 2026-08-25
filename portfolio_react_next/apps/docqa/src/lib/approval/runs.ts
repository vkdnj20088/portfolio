import {
  PRESETS,
  runLab,
  type ApprovalStatus,
  type PresetId,
  type PresetSide,
} from '@chat/approval-domain';
import data from './data/runs.json';

export interface CommittedRun {
  presetId: PresetId;
  side: PresetSide;
  title: string;
  label: string;
  approvedAtPg: number;
  approveCalls: number;
  queryCalls: number;
  requests: number;
  finalStatus: ApprovalStatus;
  settleConflicts: number;
  steps: number;
  matchesExpectation: boolean;
}

export const COMMITTED_RUNS = data.runs as CommittedRun[];
export const COMMITTED_NOTE: string = data.note;

export interface Drift {
  presetId: PresetId;
  side: PresetSide;
  field: string;
  committed: number | string;
  live: number | string;
}

/**
 * 커밋된 숫자와 지금 계산한 숫자의 차이.
 *
 * 이 데모는 키가 없어도 브라우저에서 그대로 돌기 때문에, 커밋된 산출물은 재생용이 아니라
 * **표류 감지기**다. 비어 있어야 정상이고, 비어 있지 않으면 엔진이 바뀐 것이다.
 * 이 목록을 화면과 테스트가 함께 본다 - 화면만 보면 아무도 안 볼 때 조용히 갈라진다.
 */
export function driftedRuns(): Drift[] {
  const drifts: Drift[] = [];
  for (const committed of COMMITTED_RUNS) {
    const preset = PRESETS.find((p) => p.id === committed.presetId);
    const spec = preset?.[committed.side];
    if (!spec) {
      drifts.push({
        presetId: committed.presetId,
        side: committed.side,
        field: 'preset',
        committed: committed.label,
        live: '없어진 프리셋',
      });
      continue;
    }
    const run = runLab(spec.config);
    const live = {
      approvedAtPg: run.counters.approvedAtPg,
      approveCalls: run.counters.approveCalls,
      queryCalls: run.counters.queryCalls,
      requests: run.counters.requests,
      steps: run.timeline.length,
      settleConflicts: run.settleConflicts,
      finalStatus: run.requests[0]?.status ?? 'RECEIVED',
    };
    for (const [field, value] of Object.entries(live)) {
      const before = committed[field as keyof CommittedRun];
      if (before !== value) {
        drifts.push({
          presetId: committed.presetId,
          side: committed.side,
          field,
          committed: before as number | string,
          live: value,
        });
      }
    }
  }
  return drifts;
}

/** 프리셋 하나의 끔/켬 두 실행을 한 줄로 묶는다. */
export function committedPairs(): {
  presetId: PresetId;
  title: string;
  off?: CommittedRun;
  on?: CommittedRun;
}[] {
  return PRESETS.map((preset) => ({
    presetId: preset.id,
    title: preset.title,
    off: COMMITTED_RUNS.find((r) => r.presetId === preset.id && r.side === 'off'),
    on: COMMITTED_RUNS.find((r) => r.presetId === preset.id && r.side === 'on'),
  }));
}

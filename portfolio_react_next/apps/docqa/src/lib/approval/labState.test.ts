import { describe, expect, it } from 'vitest';
import { runLab } from '@chat/approval-domain';
import { fromPreset, isContrastable, offGuardNames, patchOff, patchScenario } from './labState';

describe('실험대 상태', () => {
  it('시나리오를 바꾸면 양쪽에 같이 적용된다 - 한쪽만 바뀌면 대조가 아니다', () => {
    const next = patchScenario(fromPreset('P1'), { approverMode: 'down', ticks: 5 });
    expect(next.off.approverMode).toBe('down');
    expect(next.on.approverMode).toBe('down');
    expect(next.off.ticks).toBe(5);
    expect(next.on.ticks).toBe(5);
  });

  it('방어선을 만지면 끈 쪽만 바뀌고 켠 쪽은 기준선으로 남는다', () => {
    const next = patchOff(fromPreset('P1'), { guards: { claimTransition: false } });
    expect(next.off.guards.claimTransition).toBe(false);
    expect(next.on.guards.claimTransition).toBe(true);
    expect(next.on.guards.reconcileQuery).toBe(true);
    expect(next.on.reclaimTo).toBe('unknown');
  });

  it('손대면 프리셋 표식이 떨어진다 - 기대값이 더 이상 이 설정의 것이 아니기 때문', () => {
    expect(fromPreset('P3').presetId).toBe('P3');
    expect(patchScenario(fromPreset('P3'), { workers: 1 }).presetId).toBeNull();
    expect(patchOff(fromPreset('P3'), { reclaimTo: 'received' }).presetId).toBeNull();
  });

  it('방어선을 전부 켜 두면 대조가 성립하지 않는다고 말한다', () => {
    const allOn = patchOff(fromPreset('P1'), { guards: { reconcileQuery: true } });
    expect(offGuardNames(allOn)).toEqual([]);
    expect(isContrastable(allOn)).toBe(false);
    // 회수 목적지만 다른 경우는 대조가 성립한다 - P6 이 그 모양이다
    expect(isContrastable(fromPreset('P6'))).toBe(true);
  });

  it('프리셋에서 만든 두 실행은 실제로 다른 숫자를 낸다', () => {
    const state = fromPreset('P1');
    expect(runLab(state.off).counters.approvedAtPg).toBe(2);
    expect(runLab(state.on).counters.approvedAtPg).toBe(1);
  });
});

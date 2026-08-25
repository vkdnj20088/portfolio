import { describe, expect, it } from 'vitest';
import { COMMITTED_RUNS, committedPairs, driftedRuns } from './runs';

describe('커밋된 실행 기록', () => {
  it('프리셋 6 × 끔/켬 12건이 다 있다', () => {
    expect(COMMITTED_RUNS).toHaveLength(12);
    for (const pair of committedPairs()) {
      expect(pair.off, `${pair.presetId} off`).toBeDefined();
      expect(pair.on, `${pair.presetId} on`).toBeDefined();
    }
  });

  it('전부 기대값과 맞는 상태로 커밋돼 있다', () => {
    const missed = COMMITTED_RUNS.filter((r) => !r.matchesExpectation);
    expect(missed.map((r) => `${r.presetId}/${r.side}`)).toEqual([]);
  });

  it('지금 계산한 숫자와 갈리지 않는다 - 갈리면 엔진이 바뀐 것이다', () => {
    // 이 시험이 커밋된 산출물의 존재 이유다. 재생용이 아니라 표류 감지기라서,
    // 여기가 깨지면 산출물을 다시 만들거나(pnpm --filter @chat/docqa run make:approval-runs)
    // 엔진 변경이 의도한 것인지 확인해야 한다.
    expect(driftedRuns()).toEqual([]);
  });
});

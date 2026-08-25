import { describe, expect, it } from 'vitest';
import { runLab } from './lab';
import { PRESETS, presetById, type PresetSide } from './presets';

/**
 * 프리셋의 기대값을 시험으로 고정한다.
 *
 * 화면이 보여 주는 숫자가 곧 이 숫자다. 기대값을 코드 옆에 적어 두고 실행 결과와 맞춰
 * 두면, 엔진을 고치다 대조가 무너졌을 때 화면이 아니라 여기서 먼저 깨진다.
 */
describe.each(PRESETS)('$id $title', (preset) => {
  for (const side of ['off', 'on'] as PresetSide[]) {
    const spec = preset[side];
    it(`${side}: ${spec.label} → PG 승인 ${spec.expect.approvedAtPg}건`, () => {
      const run = runLab(spec.config);
      expect(run.counters.approvedAtPg).toBe(spec.expect.approvedAtPg);
      expect(run.counters.approveCalls).toBe(spec.expect.approveCalls);
      expect(run.counters.requests).toBe(spec.expect.requests);
      expect(run.requests[0]?.status).toBe(spec.expect.finalStatus);
      // 클레임 이후 전이가 조용히 실패한 자리는 어느 쪽에서도 없어야 한다.
      // 이건 가드의 문제가 아니라 코드가 모르는 경합이 있다는 신호다.
      expect(run.settleConflicts).toBe(0);
    });
  }

  it('가드를 끈 쪽과 켠 쪽이 관측 가능한 숫자에서 갈린다', () => {
    // 대조가 성립하지 않으면 이 프리셋은 아무것도 증명하지 않는다.
    // 승인 건수만 보면 안 된다 - P5 는 양쪽 다 0건이고, 갈리는 것은 호출 횟수와 최종 상태다.
    const { off, on } = preset;
    const differs =
      off.expect.approvedAtPg !== on.expect.approvedAtPg ||
      off.expect.approveCalls !== on.expect.approveCalls ||
      off.expect.finalStatus !== on.expect.finalStatus;
    expect(differs).toBe(true);
  });
});

describe('실험대 자체의 성질', () => {
  it('같은 설정을 두 번 돌리면 타임라인까지 같다 - 난수가 없고 시간과 ID 를 주입하기 때문', () => {
    const spec = PRESETS[0]?.off;
    if (!spec) throw new Error('프리셋이 비었다');
    const first = runLab(spec.config);
    const second = runLab(spec.config);
    expect(JSON.stringify(second.timeline)).toBe(JSON.stringify(first.timeline));
    expect(second.counters).toEqual(first.counters);
  });

  it('전이마다 왜가 붙는다 - 접수만 근거 없이 남는다', () => {
    const spec = PRESETS[1]?.on;
    if (!spec) throw new Error('프리셋이 비었다');
    const run = runLab(spec.config);
    const withoutWhy = run.timeline.filter((s) => s.why === null);
    expect(withoutWhy.map((s) => s.type)).toEqual(['PaymentReceived']);
  });

  it('P1 을 끈 쪽 타임라인에는 모름이 없다 - 2 값으로 접었다는 뜻이다', () => {
    const spec = PRESETS[0]?.off;
    if (!spec) throw new Error('프리셋이 비었다');
    const run = runLab(spec.config);
    expect(run.timeline.some((s) => s.type === 'ApprovalTimedOut')).toBe(false);
    // 대신 두 번째 승인이 나쁜 것으로 표시된다
    expect(run.timeline.filter((s) => s.tone === 'bad')).not.toHaveLength(0);
  });

  it('상한 두 종류는 격리 사유가 서로 다르다 - 한 칸에 세면 왜 멈췄는지가 뭉개진다', () => {
    // 전송 상한: PG 로 연결이 안 돼 세 번 보내고 멈춘 경우
    const sendLimited = runLab(presetById('P5').on.config);
    expect(sendLimited.timeline.at(-1)?.why).toBe('전송 시도 상한 도달');

    // 조회 상한: 승인 요청은 나갔는데 결과를 확인할 수 없어 멈춘 경우.
    // 죽은 워커가 남긴 클레임을 모름으로 회수한 뒤, PG 가 죽어 조회까지 실패하는 상황이다.
    const queryLimited = runLab({
      ...presetById('P6').on.config,
      approverMode: 'down',
      ticks: 8,
    });
    expect(queryLimited.requests[0]?.status).toBe('APPROVAL_FAILED');
    expect(queryLimited.timeline.at(-1)?.why).toBe('승인 조회 실패 상한 도달');
    // 두 사유가 같은 문자열이면 화면에서 "왜 멈췄는가"를 답할 수 없다
    expect(queryLimited.timeline.at(-1)?.why).not.toBe(sendLimited.timeline.at(-1)?.why);
  });

  it('상한을 끄면 조회 실패 쪽도 끝나지 않는다 - 실패의 끝이 정의되지 않았다는 뜻이다', () => {
    const base = presetById('P6').on.config;
    const endless = runLab({
      ...base,
      approverMode: 'down',
      guards: { ...base.guards, attemptLimit: false },
      ticks: 8,
    });
    expect(endless.requests[0]?.status).toBe('APPROVAL_UNKNOWN');
    expect(endless.timeline.some((s) => s.type === 'ApprovalQuarantined')).toBe(false);
  });
});

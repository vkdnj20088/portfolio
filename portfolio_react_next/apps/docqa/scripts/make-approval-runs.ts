/**
 * 프리셋 여섯 × 방어선 끔/켬 열두 실행을 **실제로 돌려** 결과를 커밋 파일로 굳힌다.
 *
 * 왜 굳히는가. 이 엔진은 브라우저에서 그대로 돌아서 화면이 지금 이 자리에서 다시 계산한다 -
 * 그러니 이 파일은 "키가 없어서 재생한다"는 다른 데모의 장치와 목적이 다르다. 여기서 이 파일은
 * **표류 감지기**다. 커밋된 숫자와 지금 계산한 숫자가 갈리면 엔진이 바뀐 것이고, 테스트가
 * 그 자리에서 깨진다. 화면은 두 숫자를 나란히 두고 같다는 것을 보인다.
 *
 * 수집 시각을 넣지 않는다. 실행이 결정적이라 시각만 바뀌면 내용이 같은 diff 가 매번 생기고,
 * 그러면 이 파일이 표류를 알리는 신호가 아니라 잡음이 된다. 언제 수집했는지는 커밋이 안다.
 *
 * 사용법:
 *   pnpm --filter @chat/docqa run make:approval-runs
 *
 * 외부 호출도 API 키도 필요 없다. 몇 밀리초면 끝난다.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRESETS, runLab, type PresetSide } from '@chat/approval-domain';

const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'lib',
  'approval',
  'data',
  'runs.json',
);

const runs = PRESETS.flatMap((preset) =>
  (['off', 'on'] as PresetSide[]).map((side) => {
    const spec = preset[side];
    const run = runLab(spec.config);
    const { approvedAtPg, approveCalls, queryCalls, requests } = run.counters;
    const finalStatus = run.requests[0]?.status ?? 'RECEIVED';
    const expect = spec.expect;
    return {
      presetId: preset.id,
      side,
      title: preset.title,
      label: spec.label,
      approvedAtPg,
      approveCalls,
      queryCalls,
      requests,
      finalStatus,
      settleConflicts: run.settleConflicts,
      steps: run.timeline.length,
      // 기대값과 어긋나면 감추지 않고 파일에 남긴다. 화면이 그 자리를 붉게 표시한다.
      matchesExpectation:
        approvedAtPg === expect.approvedAtPg &&
        approveCalls === expect.approveCalls &&
        requests === expect.requests &&
        finalStatus === expect.finalStatus,
    };
  }),
);

const mismatched = runs.filter((r) => !r.matchesExpectation);

writeFileSync(
  OUT,
  `${JSON.stringify(
    {
      note: '프리셋 6 × 방어선 끔/켬 = 12 실행의 결과. 난수가 없어 같은 설정은 항상 같은 숫자를 낸다. 수집 시각을 넣지 않는 이유는 스크립트 주석에 있다.',
      runs,
    },
    null,
    2,
  )}\n`,
  'utf8',
);

console.error(`실행 ${runs.length}건 기록: ${OUT}`);
if (mismatched.length > 0) {
  console.error(`기대값과 어긋난 실행 ${mismatched.length}건:`);
  for (const r of mismatched) console.error(`  ${r.presetId} ${r.side} - ${r.label}`);
  process.exitCode = 1;
}

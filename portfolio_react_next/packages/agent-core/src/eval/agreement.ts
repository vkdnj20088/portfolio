import type { Judgment } from './types';

/**
 * 심판 간 일치도 - "심판을 누가 심판하는가"의 절반.
 *
 * 나머지 절반은 앵커셋(사람 라벨)과 함정 케이스다. 일치도만으로는 심판이 **한결같이 틀리는**
 * 경우를 못 잡는다. 셋이 똑같이 틀리면 일치도는 1.0 이다.
 */

export interface Agreement {
  /** 판정이 갈리지 않은 항목의 비율. 계산이 투명해서 같이 낸다. */
  simple: number;
  /** 우연 일치를 뺀 값. */
  kappa: number;
  items: number;
  raters: number;
  /** 심판이 갈린 항목. 루브릭을 고칠 다음 작업이 여기서 나온다. */
  splits: { caseId: string; checkId: string; variantId: string; runIndex: number }[];
}

type Cell = { key: string; verdicts: Judgment['verdict'][] };

function groupCells(judgments: Judgment[]): Cell[] {
  const map = new Map<string, Judgment['verdict'][]>();
  for (const j of judgments) {
    const key = [j.caseId, j.checkId, j.variantId, j.runIndex].join('|');
    map.set(key, [...(map.get(key) ?? []), j.verdict]);
  }
  return [...map.entries()].map(([key, verdicts]) => ({ key, verdicts }));
}

/**
 * Fleiss' kappa.
 *
 * 단독으로 쓰지 않는다. 한쪽 범주로 쏠린 데이터에서 값이 과도하게 낮아지는 성질이 알려져
 * 있어서, 심판들이 거의 모든 항목에 pass 를 준 상황에서는 일치도가 높아도 kappa 가 0 근처로
 * 나온다. 그 숫자만 보고 "심판을 못 믿는다"고 읽으면 틀린다. 단순 일치율과 나란히 놓는 이유다.
 */
export function fleissKappa(cells: Cell[], categories: string[]): number {
  const n = cells[0]?.verdicts.length ?? 0;
  const N = cells.length;
  if (N === 0 || n < 2) return 0;
  // 평정자 수가 칸마다 다르면 정의되지 않는다. 수집이 균일하지 않다는 신호라 0 을 내지 않고
  // 호출자가 알 수 있게 NaN 을 낸다.
  if (cells.some((c) => c.verdicts.length !== n)) return Number.NaN;

  const counts = cells.map((c) =>
    categories.map((cat) => c.verdicts.filter((v) => v === cat).length),
  );
  const pj = categories.map((_, j) => counts.reduce((s, row) => s + row[j]!, 0) / (N * n));
  const pi = counts.map((row) => (row.reduce((s, x) => s + x * x, 0) - n) / (n * (n - 1)));
  const pBar = pi.reduce((s, x) => s + x, 0) / N;
  const peBar = pj.reduce((s, p) => s + p * p, 0);
  if (peBar === 1) return 1; // 전원이 한 범주만 쓴 경우. 우연 일치율이 1이라 정의상 나눌 수 없다.
  return (pBar - peBar) / (1 - peBar);
}

export function agreementOf(judgments: Judgment[]): Agreement {
  const cells = groupCells(judgments);
  const raters = cells[0]?.verdicts.length ?? 0;
  const unanimous = cells.filter((c) => new Set(c.verdicts).size === 1);
  const splits = cells
    .filter((c) => new Set(c.verdicts).size > 1)
    .map((c) => {
      const [caseId, checkId, variantId, runIndex] = c.key.split('|');
      return {
        caseId: caseId!,
        checkId: checkId!,
        variantId: variantId!,
        runIndex: Number(runIndex),
      };
    });
  return {
    simple: cells.length === 0 ? 0 : unanimous.length / cells.length,
    kappa: fleissKappa(cells, ['pass', 'fail', 'blocked']),
    items: cells.length,
    raters,
    splits,
  };
}

// ---------------------------------------------------------------------------
// 심판 검증
// ---------------------------------------------------------------------------

export interface JudgeTrust {
  /** 사람 라벨과 대조한 정확도. 앵커가 없으면 null. */
  anchorAccuracy: number | null;
  anchorCount: number;
  /** 함정을 잡은 비율. 못 잡으면 그 심판은 쓸 수 없다. */
  trapCaught: number;
  trapTotal: number;
}

/**
 * 심판을 믿는 근거를 수치로 남긴다.
 *
 * 이게 없으면 심판 점수는 그냥 또 하나의 LLM 출력이고, 그 위에 세운 통계는 정밀해 보이는
 * 장식이 된다. 앵커셋은 심판이 사람과 같은 방향을 보는지, 함정은 명백한 오답을 걸러내는지를
 * 본다. 둘은 다른 실패를 잡는다 - 앵커는 편향, 함정은 무능이다.
 */
export function judgeTrust(
  anchors: { caseId: string; variantId: string; runIndex: number; humanLabel: boolean }[],
  judgments: Judgment[],
  trapJudgments: Judgment[],
): JudgeTrust {
  const anchored = anchors
    .map((a) => {
      // 라벨은 **특정 실행 하나**에 붙는다. 케이스 전체로 뭉뚱그리면 구성과 회차가 섞여
      // 사람이 무엇을 보고 라벨을 달았는지가 사라진다.
      const votes = judgments.filter(
        (j) => j.caseId === a.caseId && j.variantId === a.variantId && j.runIndex === a.runIndex,
      );
      if (votes.length === 0) return null;
      const pass = votes.filter((v) => v.verdict === 'pass').length > votes.length / 2;
      return pass === a.humanLabel;
    })
    .filter((x): x is boolean => x !== null);

  const trapCells = groupCells(trapJudgments);
  const caught = trapCells.filter(
    (c) => c.verdicts.filter((v) => v === 'fail').length > c.verdicts.length / 2,
  ).length;

  return {
    anchorAccuracy:
      anchored.length === 0 ? null : anchored.filter(Boolean).length / anchored.length,
    anchorCount: anchored.length,
    trapCaught: caught,
    trapTotal: trapCells.length,
  };
}

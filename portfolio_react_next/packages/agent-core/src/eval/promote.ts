import type { TraceArtifact } from '../types';
import type { Check, EvalCase } from './types';

/**
 * 승격 - 실행 하나를 eval 케이스로 올린다.
 *
 * **자동 승격은 하지 않는다.** 실패한 실행을 자동으로 기대값으로 굳히면 지금 동작이 정답이
 * 되고, 그 뒤로는 회귀를 못 잡는 게 아니라 회귀를 정답이라고 부르게 된다. 사람이 span 을
 * 보고 판단하는 것이 이 층의 유일한 수동 지점이고, 그래서 이 파일이 하는 일은 판단 대신
 * **후보 제안**까지다.
 *
 * 무키 배포에서 승격 버튼이 무엇을 하는가: 케이스 JSON 을 만들어 화면에 띄우고 복사시킨다.
 * 실제 승격은 로컬에서 커밋으로 일어난다. 이건 우회가 아니라 옳은 형태다 - eval 데이터셋은
 * 코드와 함께 버전 관리되는 자산이지 런타임 상태가 아니다.
 */

/** 실행에서 읽어 낸, 사람이 고를 체크 후보. 고르는 것은 사람이다. */
export function proposeChecks(trace: TraceArtifact): Check[] {
  const toolNames = [
    ...new Set(
      trace.spans.filter((s) => s.kind === 'tool').map((s) => s.name.replace(/ 재시도 \d+$/, '')),
    ),
  ];
  const checks: Check[] = [
    {
      id: 'state',
      kind: 'structure',
      label: `최종 상태가 ${trace.finalState} 여야 한다`,
      assertion: { op: 'finalStateIs', state: trace.finalState },
    },
  ];
  for (const name of toolNames) {
    checks.push({
      id: `tool-${name.replace(/\./g, '-')}`,
      kind: 'structure',
      label: `${name} 을 최소 1회 불러야 한다`,
      assertion: { op: 'toolCalledAtLeast', tool: name, times: 1 },
    });
  }
  if (trace.finalState !== 'exhausted') {
    checks.push({
      id: 'budget',
      kind: 'structure',
      label: '예산 안에서 끝나야 한다',
      assertion: { op: 'withinBudget' },
    });
  }
  checks.push({
    id: 'citation',
    kind: 'citation',
    label: '인용한 문단이 도구 출력에 실제로 있어야 한다',
  });
  checks.push({
    id: 'answers-question',
    kind: 'judge',
    label: '과제가 물은 것에 답했는가',
    question: '이 답변은 과제가 물은 것에 실제로 답하고 있습니까?',
  });
  return checks;
}

/** 화면의 승격 버튼이 그대로 뱉는 초안. 사람이 체크를 덜어내고 커밋한다. */
export function proposeCase(
  trace: TraceArtifact,
  opts: { caseId: string; variantId: string; runIndex: number; spanId: string },
): EvalCase {
  return {
    id: opts.caseId,
    scenarioId: trace.scenarioId,
    title: trace.title,
    origin: {
      scenarioId: trace.scenarioId,
      variantId: opts.variantId,
      runIndex: opts.runIndex,
      spanId: opts.spanId,
    },
    checks: proposeChecks(trace),
    humanLabel: null,
  };
}

/**
 * 역인덱스 - trace 의 `evalCaseId` 를 채우는 쪽.
 *
 * 진실원은 케이스의 `origin` 이다. span 쪽 필드는 화면이 "이 span 은 케이스가 됐다"를
 * 표시하려고 두는 사본이라, 사본이 원본과 어긋나면 테스트가 잡아야 한다.
 */
export function originKey(o: {
  scenarioId: string;
  variantId: string;
  runIndex: number;
  spanId: string;
}): string {
  return [o.scenarioId, o.variantId, o.runIndex, o.spanId].join('|');
}

export function backIndex(cases: EvalCase[]): Map<string, string> {
  return new Map(cases.map((c) => [originKey(c.origin), c.id]));
}

export interface OriginReport {
  /** 채점을 망가뜨리는 것. 화면이 수치를 보이기 전에 비어 있어야 한다. */
  errors: string[];
  /** 채점에는 영향이 없고 되짚기 링크만 끊긴 것. 화면은 사실만 적는다. */
  staleAnchors: string[];
}

/**
 * 케이스가 가리키는 자리가 성립하는지 검사한다.
 *
 * 둘을 갈라 내는 것이 요점이다. `scenarioId` 가 어긋난 케이스는 **채점에서 조용히 빠져**
 * 통과율을 올리므로 오류다. 반면 `spanId` 가 안 맞는 것은 채점을 건드리지 않는다 - 채점은
 * 시나리오 단위로 붙고 spanId 는 "사람이 어디를 보다가 승격했나"를 남기는 자리이기 때문이다.
 *
 * 이 구분이 필요해진 계기가 있다. 재수집을 하면 스텝 수가 달라지면서 안쪽 span 의 id 가
 * 밀린다(시드가 같아도 카운터 위치가 바뀐다). 그때 링크가 끊긴 것을 오류로 부르면 재수집
 * 때마다 빨간불이 켜지고, 진짜 오류와 구분이 안 된다. 1단계에서 도구집합 해시로 낡음을
 * 따로 표시한 것과 같은 처리다.
 */
export function validateOrigins(cases: EvalCase[], traces: TraceArtifact[]): OriginReport {
  const errors: string[] = [];
  const staleAnchors: string[] = [];
  const byScenario = new Map(traces.map((t) => [t.scenarioId, t]));
  const index = backIndex(cases);

  for (const c of cases) {
    if (c.origin.scenarioId !== c.scenarioId) {
      errors.push(`${c.id}: origin.scenarioId 가 케이스의 scenarioId 와 다르다`);
    }
    const trace = byScenario.get(c.origin.scenarioId);
    if (!trace) continue; // 원본이 다른 구성/회차라 이 번들에 없을 수 있다. 없는 것은 오류가 아니다.
    if (!trace.spans.some((s) => s.spanId === c.origin.spanId)) {
      staleAnchors.push(`${c.id}: 승격 당시의 span(${c.origin.spanId})이 지금 기록에 없다`);
    }
  }

  for (const t of traces) {
    for (const s of t.spans) {
      if (!s.evalCaseId) continue;
      const expected = index.get(
        originKey({ scenarioId: t.scenarioId, variantId: 'A', runIndex: 0, spanId: s.spanId }),
      );
      if (expected !== s.evalCaseId) {
        errors.push(`${t.scenarioId}/${s.spanId}: evalCaseId 가 케이스의 origin 과 어긋난다`);
      }
    }
  }
  return { errors, staleAnchors };
}

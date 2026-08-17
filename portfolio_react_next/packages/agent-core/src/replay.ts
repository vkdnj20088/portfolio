import { digest } from './digest';
import type { Span, SpanVerification, ToolContext, ToolDefinition, TraceArtifact } from './types';

/**
 * 재생 검증 - **이 데모가 다른 trace 뷰어와 갈리는 지점**.
 *
 * 배포에는 키가 없으므로 모델 왕복은 커밋된 응답을 재생한다. 그런데 도구는 이 저장소의 다른
 * 데모를 부르는 순수/결정적 함수이므로 **재생 때 다시 실행할 수 있다**. 다시 실행해 출력
 * 다이제스트가 커밋본과 같으면, 그 span 은 박제가 아니라 지금 이 순간에도 참인 값이다.
 *
 * 판정을 3값으로 두는 것이 중요하다. Spring 이 떠 있지 않은 환경(CI, 로컬 개발)에서는 도구가
 * 도달 불가인데, 그것을 `mismatch` 로 뭉뚱그리면 화면이 "값이 달라졌다"고 거짓말을 한다.
 * 도달 못 한 것과 값이 달라진 것은 다른 사실이고, 화면은 그 둘을 다르게 말해야 한다.
 */
export async function verifyToolSpans(
  trace: TraceArtifact,
  tools: Map<string, ToolDefinition>,
  ctx: ToolContext,
): Promise<SpanVerification[]> {
  const out: SpanVerification[] = [];
  for (const span of trace.spans) {
    if (span.kind !== 'tool') continue;
    out.push(await verifyOne(span, tools, ctx));
  }
  return out;
}

async function verifyOne(
  span: Span,
  tools: Map<string, ToolDefinition>,
  ctx: ToolContext,
): Promise<SpanVerification> {
  const name = span.attrs['tool.name'] ?? '';
  const tool = tools.get(name);
  if (!tool) {
    return { spanId: span.spanId, verdict: 'unverified', detail: `도구 ${name} 이 없습니다` };
  }

  // **부작용이 있는 도구는 재생하지 않는다.**
  //
  // 3단계에서 부작용 도구가 들어오면서 이 자리가 구멍이 됐다. 재생 검증은 화면을 열 때마다
  // 도는데, 그때 예약 도구를 다시 부르면 배포된 서버가 방문자 수만큼 작업을 만든다. 승인
  // 게이트를 세워 두고 재생 경로로 그것을 우회하면 게이트가 있으나 마나다.
  //
  // 지금 커밋된 trace 에는 부작용 도구가 없어서 실제로 일어난 적은 없다. 일어난 적 없는 사고를
  // 막는 코드가 필요한 이유는, 이 방어가 "커밋된 trace 에 무엇이 들어 있는가"에 의존하면 안
  // 되기 때문이다 - 그 조건은 승격 한 번으로 깨진다.
  if (tool.sideEffect) {
    return {
      spanId: span.spanId,
      verdict: 'unverified',
      detail: '부작용이 있는 도구라 재생하지 않습니다 - 다시 부르면 실제로 다시 일어납니다',
    };
  }

  // 실패가 주입된 시도는 재실행하지 않는다. 주입은 시나리오가 정한 결정적 실패라 도구를 다시
  // 불러도 같은 실패가 나야 하는데, 실제 호출은 성공해 버려 오탐이 된다.
  const injected = span.attrs['tool.injected_failure'];
  if (injected) {
    return {
      spanId: span.spanId,
      verdict: 'verified',
      detail: `결정적 실패 주입(${injected}) - 재실행 없이 같은 실패가 재현됩니다`,
    };
  }

  const input = span.attrs['tool.input'];
  if (input === undefined) {
    return { spanId: span.spanId, verdict: 'unverified', detail: '입력이 기록되지 않았습니다' };
  }

  try {
    const result = await tool.run(input as Record<string, unknown>, ctx);
    if (!result.ok) {
      // 도구가 지금 실패한다고 해서 커밋본이 틀린 것은 아니다(서버가 안 떠 있을 수 있다).
      return {
        spanId: span.spanId,
        verdict:
          result.code === 'UNREACHABLE' || result.code === 'TIMEOUT' ? 'unverified' : 'mismatch',
        detail: `재실행 실패: ${result.code} ${result.message}`,
      };
    }
    const now = digest(result.value);
    const then = span.attrs['tool.output_digest'];
    if (now === then) {
      return { spanId: span.spanId, verdict: 'verified', detail: `출력 다이제스트 일치 (${now})` };
    }
    return {
      spanId: span.spanId,
      verdict: 'mismatch',
      detail: `커밋 ${then ?? '(없음)'} vs 지금 ${now}`,
    };
  } catch (e) {
    return {
      spanId: span.spanId,
      verdict: 'unverified',
      detail: `재실행 중 예외: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/**
 * 도구 집합의 다이제스트 - 스키마와 픽스처가 바뀌면 커밋된 trace 가 낡는다.
 *
 * DocuQA 의 `staleCases` 와 같은 장치지만 한 단계 넓다. 그쪽은 "질문에 준 후보가 달라졌나"를
 * 보고, 여기서는 **도구 계약 자체가 달라졌나**를 본다. 계약이 같은데 동작만 달라진 경우는
 * 이 다이제스트가 못 잡는데, 그 자리는 위 도구 재실행이 받는다. 둘이 서로의 빈틈을 덮는다.
 */
function toolShape(t: ToolDefinition) {
  return {
    name: t.name,
    inputSchema: t.inputSchema,
    outputSchema: t.outputSchema,
    sideEffect: t.sideEffect,
    requiresApproval: t.requiresApproval,
    fixtures: [...t.fixtures].sort(),
  };
}

export function toolsetDigest(tools: ToolDefinition[]): string {
  const shape = [...tools].sort((a, b) => (a.name < b.name ? -1 : 1)).map(toolShape);
  return digest(shape);
}

/**
 * **도구별** 계약 해시.
 *
 * 집합 전체 해시만 두었더니 재수집 비용이 실제 변경과 무관하게 붙었다. 3단계에서 도구를 둘
 * 늘렸을 뿐인데 앞의 실행 서른 건과 심판 백스물여섯 건이 통째로 낡음이 됐다 - 그 실행들은
 * 새 도구를 부른 적조차 없는데도. 낡음은 집합의 성질이 아니라 **그 실행이 실제로 쓴 도구**의
 * 성질이다.
 *
 * 집합 해시는 그대로 둔다. 값이 도구별 해시의 함수라 둘이 어긋날 수 없고, 이미 커밋된
 * 산출물과도 바이트 단위로 같다.
 */
export function toolDigests(tools: ToolDefinition[]): Record<string, string> {
  return Object.fromEntries(tools.map((t) => [t.name, digest(toolShape(t))]));
}

/** 이 실행이 실제로 부른 도구 이름들. 재시도로 같은 도구가 여러 번 나와도 한 번만 센다. */
export function usedToolNames(trace: Pick<TraceArtifact, 'spans'>): string[] {
  return [
    ...new Set(
      trace.spans
        .filter((s) => s.kind === 'tool')
        .map((s) => s.attrs['tool.name'] ?? s.name)
        .filter((n): n is string => Boolean(n)),
    ),
  ];
}

export interface StaleReport {
  stale: boolean;
  /** 이 실행이 쓴 도구 중 계약이 달라진 것. 무엇을 다시 받아야 하는지가 여기 있다. */
  changed: string[];
  /**
   * 도구별 해시가 산출물에 없어 집합 해시로만 판정했는가.
   *
   * 옛 산출물은 도구별 해시를 갖고 있지 않다. 그 경우 판정을 거절하는 대신 예전 방식으로
   * 떨어지되, **거칠게 봤다는 사실을 표시**한다. 감추면 "도구 하나 바꿨는데 전부 낡았다"가
   * 왜 그런지 알 수 없는 결과가 된다.
   */
  coarse: boolean;
  committed: string;
  current: string;
}

export interface ToolFingerprint {
  toolsetDigest: string;
  toolDigests: Record<string, string>;
}

/**
 * 커밋된 실행이 지금 도구와 어긋났는지.
 *
 * 대조 범위가 요점이다. **그 실행이 쓴 도구만** 본다. 새 도구가 늘어난 것은 이미 커밋된
 * 실행에 아무 영향이 없고, 영향이 없는 변경으로 재수집을 부르면 수집 비용이 코드 변경마다
 * 붙어 결국 아무도 도구를 건드리지 않게 된다.
 */
export function checkStale(
  trace: TraceArtifact & { toolDigests?: Record<string, string> },
  current: string | ToolFingerprint,
  committedToolDigests?: Record<string, string>,
): StaleReport {
  const fingerprint: ToolFingerprint =
    typeof current === 'string' ? { toolsetDigest: current, toolDigests: {} } : current;
  const committed = committedToolDigests ?? trace.toolDigests;

  if (!committed || Object.keys(fingerprint.toolDigests).length === 0) {
    const stale = trace.toolsetDigest !== fingerprint.toolsetDigest;
    return {
      stale,
      changed: [],
      coarse: true,
      committed: trace.toolsetDigest,
      current: fingerprint.toolsetDigest,
    };
  }

  const changed = usedToolNames(trace).filter(
    (name) => committed[name] !== fingerprint.toolDigests[name],
  );
  return {
    stale: changed.length > 0,
    changed,
    coarse: false,
    committed: trace.toolsetDigest,
    current: fingerprint.toolsetDigest,
  };
}

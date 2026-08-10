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
export function toolsetDigest(tools: ToolDefinition[]): string {
  const shape = [...tools]
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .map((t) => ({
      name: t.name,
      inputSchema: t.inputSchema,
      outputSchema: t.outputSchema,
      sideEffect: t.sideEffect,
      requiresApproval: t.requiresApproval,
      fixtures: [...t.fixtures].sort(),
    }));
  return digest(shape);
}

export interface StaleReport {
  stale: boolean;
  committed: string;
  current: string;
}

export function checkStale(trace: TraceArtifact, currentDigest: string): StaleReport {
  return {
    stale: trace.toolsetDigest !== currentDigest,
    committed: trace.toolsetDigest,
    current: currentDigest,
  };
}

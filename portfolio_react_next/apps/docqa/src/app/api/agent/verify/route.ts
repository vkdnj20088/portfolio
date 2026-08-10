import { verifyToolSpans } from '@chat/agent-core';
import { problemResponse } from '@chat/ui';
import { TOOL_BY_NAME } from '@/lib/agent/tools';
import { CURRENT_TOOLSET_DIGEST, staleReport, traceById } from '@/lib/agent/traces';

/**
 * 재생 검증 - 커밋된 trace 의 도구 호출을 **지금 다시 실행**해 출력을 대조한다.
 *
 * 이 라우트가 서버에 있는 이유: 도구 하나가 Spring(127.0.0.1:8080)을 부른다. 브라우저에서
 * 직접 치면 그 주소에 닿지 못하고 CSP 도 막는다. 서버가 대신 부르고 판정만 화면으로 보낸다.
 *
 * 판정은 3값이다. Spring 이 떠 있지 않은 환경에서는 `unverified` 가 나오는데, 그것을
 * `mismatch` 로 뭉뚱그리면 화면이 "값이 달라졌다"고 거짓말을 한다. 도달 못 한 것과 값이
 * 달라진 것은 다른 사실이다.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const scenarioId = new URL(req.url).searchParams.get('scenario') ?? '';
  const trace = traceById(scenarioId);
  if (!trace) {
    return problemResponse(404, 'NOT_FOUND', '시나리오 없음', '커밋된 trace 가 없습니다.', {
      instance: '/api/agent/verify',
    });
  }

  // 재실행에도 같은 상관 ID 를 쓴다. 그래야 서버 로그에서 "이 trace 의 검증"으로 묶인다.
  const correlationId =
    trace.spans.find((s) => s.kind === 'run')?.attrs.correlation_id ?? scenarioId;
  const verifications = await verifyToolSpans(trace, TOOL_BY_NAME, { correlationId });

  return Response.json(
    {
      scenarioId,
      correlationId,
      toolsetDigest: CURRENT_TOOLSET_DIGEST,
      stale: staleReport(),
      verifications,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

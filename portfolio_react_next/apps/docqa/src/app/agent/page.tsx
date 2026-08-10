'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  STATE_LABEL,
  alwaysExpanded,
  budgetPressure,
  buildTree,
  flatten,
  rollUp,
  stateTone,
  type ReplayVerdict,
  type Span,
  type SpanNode,
  type SpanVerification,
  type TraceArtifact,
} from '@chat/agent-core';
import { AppShell } from '@/components/AppShell';
import { hasTraces, traceBundle } from '@/lib/agent/traces';

/**
 * 에이전트 실행 되짚기 - 이 화면이 30초 안에 말하려는 것은 하나다.
 *
 *   "에이전트가 답을 어떻게 만들었는지, 성공이든 실패든 도구 호출 하나하나까지 되짚을 수 있다."
 *
 * 그래서 화면 순서를 그 문장에서 역산했다. 무엇을 시켰나(과제) -> 어떻게 끝났나(상태) ->
 * 무슨 도구를 어떤 순서로(트리) -> 얼마나 썼나(예산). 트리는 도구까지 펼친 채로 두고,
 * 접는 것은 span 별 페이로드다 - 도구 호출이 이 화면의 본체이기 때문이다.
 *
 * 실패를 숨기지 않는다. 시나리오 칩에 상태색을 박아 실패한 실행이 첫 화면에서 보이고,
 * 실패한 span 은 접히지 않는다(agent-core/tree.ts 의 alwaysExpanded).
 */
const BUNDLE = traceBundle();

export default function AgentPage() {
  const [selectedId, setSelectedId] = useState(BUNDLE.traces[0]?.scenarioId ?? '');
  const trace = BUNDLE.traces.find((t) => t.scenarioId === selectedId);

  return (
    <AppShell>
      <div className="page">
        <div className="pageHead">
          <h1>에이전트 실행 되짚기</h1>
          <p>
            도구를 쓰는 에이전트가 다단계로 과제를 풀고, 그 실행 전체가 <b>span 트리</b>로 남습니다.
            성공한 실행만이 아니라 도구가 실패한 실행과 예산에 걸려 멈춘 실행도 같은 방식으로
            되짚습니다. 도구는 이 포트폴리오의 다른 데모(문서 검색/근거 QA, IP 접근 제어)를 그대로
            부릅니다.
          </p>
        </div>

        {!hasTraces() ? <NotCollected /> : trace ? <TraceView trace={trace} /> : null}

        <ScenarioTable selectedId={selectedId} onSelect={setSelectedId} />
      </div>
    </AppShell>
  );

  function ScenarioTable({
    selectedId,
    onSelect,
  }: {
    selectedId: string;
    onSelect: (id: string) => void;
  }) {
    if (!hasTraces()) return null;
    return (
      <>
        <h2 className="evalH2">실행 목록</h2>
        <div className="agentChips" role="group" aria-label="시나리오">
          {BUNDLE.traces.map((t) => (
            <button
              key={t.scenarioId}
              type="button"
              className={`agentChip tone-${stateTone(t.finalState)}${t.scenarioId === selectedId ? ' isOn' : ''}`}
              aria-pressed={t.scenarioId === selectedId}
              onClick={() => onSelect(t.scenarioId)}
            >
              <span className="cTitle">{t.title}</span>
              <span className="cState">{STATE_LABEL[t.finalState]}</span>
            </button>
          ))}
        </div>
      </>
    );
  }
}

/** 수집 전 상태. 실시간 실행인 척 채워 넣는 대신 비어 있다고 적는다(§0). */
function NotCollected() {
  return (
    <div className="agentEmpty">
      <h2>아직 수집 전입니다</h2>
      <p>
        이 배포에는 API 키가 없습니다. 실행 기록은 키를 가진 사람이 시나리오를 한 번 실제로 돌려
        커밋한 span 을 재생하는 방식인데, 그 산출물이 아직 비어 있습니다. 실시간 실행인 척 채워 넣는
        대신 비어 있다고 적어 둡니다.
      </p>
      <p className="evalNote">
        도구 자체는 지금도 살아 있습니다. 수집이 끝나면 이 화면은 커밋된 모델 응답을 재생하면서
        도구는 그 자리에서 다시 실행해 출력을 대조합니다.
      </p>
    </div>
  );
}

function TraceView({ trace }: { trace: TraceArtifact }) {
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);
  const [verifications, setVerifications] = useState<SpanVerification[] | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const nodes = useMemo(() => flatten(buildTree(trace.spans)), [trace]);
  const spent = useMemo(() => rollUp(trace.spans), [trace]);
  const pressure = budgetPressure(spent, trace.budget);

  // 도구 재실행은 서버가 한다(도구 하나가 Spring 을 부른다). 화면은 판정만 받아 배지를 채운다.
  useEffect(() => {
    let alive = true;
    setVerifications(null);
    setVerifyError(null);
    fetch(`/api/agent/verify?scenario=${encodeURIComponent(trace.scenarioId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`검증 요청이 ${r.status}`))))
      .then((data: { verifications: SpanVerification[] }) => {
        if (alive) setVerifications(data.verifications);
      })
      .catch((e: Error) => {
        if (alive) setVerifyError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [trace.scenarioId]);

  const verdictBySpan = new Map((verifications ?? []).map((v) => [v.spanId, v]));
  const selected = trace.spans.find((s) => s.spanId === selectedSpanId) ?? null;

  return (
    <>
      <div className="agentRunHead">
        <div className="rhTop">
          <span className={`stateBadge tone-${stateTone(trace.finalState)}`}>
            {STATE_LABEL[trace.finalState]}
          </span>
          <span className="replayNote">
            모델 응답은 커밋된 것을 재생, <b>도구는 지금 실행</b>
          </span>
        </div>
        <p className="rhTask">{trace.taskPrompt}</p>
        {trace.summary ? <p className="rhSummary">{trace.summary}</p> : null}
        <dl className="rhMetrics">
          <div>
            <dt>스텝</dt>
            <dd>
              {spent.steps} / {trace.budget.maxSteps}
            </dd>
          </div>
          <div>
            <dt>도구 호출</dt>
            <dd>
              {spent.toolCalls} / {trace.budget.maxToolCalls}
            </dd>
          </div>
          <div>
            <dt>입력 토큰</dt>
            <dd>{spent.inputTokens.toLocaleString()}</dd>
          </div>
          <div>
            <dt>출력 토큰</dt>
            <dd>{spent.outputTokens.toLocaleString()}</dd>
          </div>
          <div>
            <dt>총 시간</dt>
            <dd>{(spent.wallMs / 1000).toFixed(1)}s</dd>
          </div>
        </dl>
        <div className="budgetBar" aria-hidden="true">
          <span style={{ width: `${Math.min(100, Math.round(pressure.ratio * 100))}%` }} />
        </div>
        <p className="evalNote">
          먼저 바닥나는 축은 <b>{pressure.axis}</b>({Math.round(pressure.ratio * 100)}%)입니다. 토큰
          단가는 여기서 환산하지 않습니다 - 단가는 바뀌고, 문서에 박으면 그때부터 썩습니다.
        </p>
      </div>

      <div className="agentSplit">
        <div className="agentTree" role="tree" aria-label="실행 span 트리">
          {nodes.map((node) => (
            <SpanRow
              key={node.span.spanId}
              node={node}
              verification={verdictBySpan.get(node.span.spanId)}
              pending={verifications === null && verifyError === null}
              selected={node.span.spanId === selectedSpanId}
              onSelect={() => setSelectedSpanId(node.span.spanId)}
            />
          ))}
        </div>
        <aside className="agentDetail" aria-label="선택한 span 상세">
          {selected ? (
            <SpanDetail span={selected} verification={verdictBySpan.get(selected.spanId)} />
          ) : (
            <p className="evalNote">트리에서 span 을 고르면 입력과 출력, 속성이 여기 나옵니다.</p>
          )}
        </aside>
      </div>

      {verifyError ? (
        <p className="evalNote">도구 재실행 검증을 받지 못했습니다: {verifyError}</p>
      ) : null}
    </>
  );
}

function SpanRow({
  node,
  verification,
  pending,
  selected,
  onSelect,
}: {
  node: SpanNode;
  verification?: SpanVerification;
  pending: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const { span, depth, selfMs } = node;
  const failed = alwaysExpanded(span);
  return (
    <button
      type="button"
      className={`spanRow${selected ? ' isOn' : ''}${failed ? ' isFailed' : ''}`}
      style={{ paddingLeft: `${8 + depth * 18}px` }}
      onClick={onSelect}
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={selected}
    >
      <span className={`spanKind k-${span.kind}`}>{span.kind}</span>
      <span className="spanName">
        {span.name}
        {span.attrs['tool.attempt'] && span.attrs['tool.attempt'] > 1 ? (
          <em className="attempt">재시도 {span.attrs['tool.attempt']}</em>
        ) : null}
      </span>
      {span.kind === 'tool' ? <VerifyBadge verification={verification} pending={pending} /> : null}
      {span.status !== 'ok' ? (
        <span className="spanErr">{span.error?.code ?? span.status}</span>
      ) : null}
      <span className="spanMs">
        {span.durationMs}ms
        {node.children.length > 0 ? <em> (자기 {selfMs}ms)</em> : null}
      </span>
    </button>
  );
}

const VERDICT_LABEL: Record<ReplayVerdict, string> = {
  verified: '재실행 일치',
  mismatch: '출력 달라짐',
  unverified: '재실행 불가',
};

function VerifyBadge({
  verification,
  pending,
}: {
  verification?: SpanVerification;
  pending: boolean;
}) {
  if (pending) return <span className="verifyBadge v-pending">확인 중</span>;
  if (!verification) return null;
  return (
    <span className={`verifyBadge v-${verification.verdict}`} title={verification.detail}>
      {VERDICT_LABEL[verification.verdict]}
    </span>
  );
}

function SpanDetail({ span, verification }: { span: Span; verification?: SpanVerification }) {
  const a = span.attrs;
  return (
    <div className="spanDetail">
      <h3>{span.name}</h3>
      <dl className="sdMeta">
        <div>
          <dt>종류</dt>
          <dd>{span.kind}</dd>
        </div>
        <div>
          <dt>상태</dt>
          <dd>{span.status}</dd>
        </div>
        <div>
          <dt>시작</dt>
          <dd>t+{span.startOffsetMs}ms</dd>
        </div>
        <div>
          <dt>지속</dt>
          <dd>{span.durationMs}ms</dd>
        </div>
      </dl>

      {span.error ? (
        <p className="sdError">
          {span.error.code} - {span.error.message}
          {span.error.retryable ? ' (재시도 대상)' : ' (재시도 없음)'}
        </p>
      ) : null}

      {verification ? (
        <p className="evalNote">
          <b>{VERDICT_LABEL[verification.verdict]}</b> - {verification.detail}
        </p>
      ) : null}

      {a['gen_ai.request.model'] ? (
        <dl className="sdMeta">
          <div>
            <dt>모델</dt>
            <dd>{a['gen_ai.request.model']}</dd>
          </div>
          <div>
            <dt>입력 토큰</dt>
            <dd>{a['gen_ai.usage.input_tokens']}</dd>
          </div>
          <div>
            <dt>출력 토큰</dt>
            <dd>{a['gen_ai.usage.output_tokens']}</dd>
          </div>
          <div>
            <dt>종료 사유</dt>
            <dd>{a['gen_ai.response.finish_reason']}</dd>
          </div>
        </dl>
      ) : null}

      {a['tool.input'] !== undefined ? (
        <details>
          <summary>도구 입력 (다이제스트 {a['tool.input_digest']})</summary>
          <pre>{JSON.stringify(a['tool.input'], null, 2)}</pre>
        </details>
      ) : null}
      {a['tool.output'] !== undefined ? (
        <details>
          <summary>도구 출력 (다이제스트 {a['tool.output_digest']})</summary>
          <pre>{JSON.stringify(a['tool.output'], null, 2)}</pre>
        </details>
      ) : null}
      {a['gen_ai.messages'] ? (
        <details>
          <summary>모델 메시지 원문</summary>
          <pre>{a['gen_ai.messages'].map((m) => `[${m.role}] ${m.text}`).join('\n\n')}</pre>
        </details>
      ) : null}
      {a['tool.arg_sources'] ? (
        <details>
          <summary>인자 출처</summary>
          <pre>{JSON.stringify(a['tool.arg_sources'], null, 2)}</pre>
        </details>
      ) : null}
      {a.correlation_id ? (
        <p className="evalNote">
          상관 ID <code>{a.correlation_id}</code> - 이 값이 <code>X-Request-Id</code> 로 나가서 IP
          접근 제어 서버의 구조화 로그에 같은 ID 로 찍힙니다.
        </p>
      ) : null}
    </div>
  );
}

/**
 * 시나리오를 **실제로 실행**해 span trace 를 커밋 파일로 굳힌다.
 *
 * 왜: 배포에는 API 키를 두지 않는다(§0). 그러면 "에이전트가 도구를 부르며 다단계로 푼다"는 말이
 * 배포에서 확인되지 않는다. 키를 가진 사람이 한 번 실행해 span 을 커밋해 두면 무키 서버가 그것을
 * 재생한다. 챗의 llm-samples.json, 대출 분류의 판정 캐시, DocuQA 의 LLM 베이스라인과 같은 장치다.
 *
 * 다만 한 가지가 다르다 - **도구는 재생 때 다시 실행한다.** 도구가 전부 결정적이라 가능한 일이고,
 * 그래서 커밋된 trace 가 박제가 아니다. 이 스크립트는 그 대조에 쓸 입출력 다이제스트를 함께 남긴다.
 *
 * 재시도는 **하네스가** 한다. 모델에게 재시도를 맡기면 같은 실패에 스텝을 계속 태운다. 대기 시간은
 * 시드 기반 순수 함수라(작업 릴레이와 같은 규약) 실패 타임라인이 재생에서도 같은 모양이 된다.
 *
 * 사용법(키가 있는 로컬에서 1회):
 *   ANTHROPIC_API_KEY=sk-ant-... pnpm --filter @chat/docqa run make:agent-traces
 *   git add apps/docqa/src/lib/agent/data/traces.json && git commit
 *
 * guard 도구는 Spring 이 떠 있어야 한다(./gradlew bootRun). 안 떠 있으면 그 시나리오의 도구
 * 호출이 UNREACHABLE 로 기록되는데, 그것도 사실이라 그대로 커밋해도 화면은 정직하다.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import {
  DEFAULT_BACKOFF,
  backoffDelayMs,
  checkBudget,
  createIdFactory,
  digest,
  rollUp,
  toolsetDigest,
  transition,
  type RunState,
  type Span,
  type ToolDefinition,
  type ToolResult,
  type TraceArtifact,
} from '@chat/agent-core';
import { TOOLS, TOOL_BY_NAME } from '../src/lib/agent/tools';
import { SCENARIOS, type Scenario } from '../src/lib/agent/scenarios';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'src', 'lib', 'agent', 'data', 'traces.json');

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
const MAX_TOKENS = 1024;

const SYSTEM_PROMPT = [
  '당신은 JC 포트폴리오 데모의 사내 운영 보조입니다. 주어진 도구로만 사실을 확인하고,',
  '도구가 돌려준 것 밖의 내용을 지어내지 않습니다.',
  'docqa.answer 가 answered=false 를 돌려주면 코퍼스에 근거가 없다는 뜻입니다.',
  '그 경우 추측하지 말고 "사내문서에서 근거를 찾지 못했습니다"라고 답하고 끝냅니다.',
  '답에는 근거가 된 문단 id 를 함께 적습니다. 한국어 존댓말로 간결하게 씁니다.',
].join(' ');

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY 가 필요합니다 - 이 스크립트만 실제 API 를 부릅니다.');
  process.exit(2);
}

const client = new Anthropic();
const generatedAt = new Date().toISOString();
const digestOfToolset = toolsetDigest(TOOLS);

const anthropicTools = TOOLS.map((t) => ({
  name: t.name.replace('.', '_'), // 모델 도구 이름은 [a-zA-Z0-9_-] 만 허용한다
  description: t.description,
  input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
}));
const toolNameFromModel = new Map(TOOLS.map((t) => [t.name.replace('.', '_'), t.name]));

// tsx 는 이 앱(Next, CJS)에서 .ts 를 CJS 로 변환하므로 top-level await 을 쓸 수 없다.
// main() 으로 감싸는 것이 모듈 형식에 기대지 않는 방법이다.
async function main() {
  const traces: TraceArtifact[] = [];
  for (const scenario of SCENARIOS) {
    console.error(`\n== ${scenario.id} : ${scenario.title}`);
    traces.push(await runScenario(scenario));
  }

  writeFileSync(
    OUT,
    JSON.stringify({ generatedAt, toolsetDigest: digestOfToolset, traces }, null, 2) + '\n',
    'utf8',
  );
  console.error(`\n${traces.length}건을 ${OUT} 에 저장했습니다.`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});

// ---------------------------------------------------------------------------

async function runScenario(scenario: Scenario): Promise<TraceArtifact> {
  const ids = createIdFactory(scenario.id);
  const traceId = ids.traceId();
  const runSpanId = ids.spanId();
  const t0 = Date.now();
  const spans: Span[] = [];
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: scenario.task }];

  let state: RunState = transition('pending', 'running');
  let approvalUsed = false;
  let summary = '';

  const offset = () => Date.now() - t0;

  while (true) {
    const spent = rollUp([...spans, runSpan()]);
    const verdict = checkBudget(spent, scenario.budget);
    if (verdict === 'hard') {
      state = transition(state, 'exhausted');
      summary = '예산 상한에 걸려 중단했습니다. 부분 결과는 아래 트리에 남아 있습니다.';
      break;
    }
    if (verdict === 'soft' && !approvalUsed) {
      // HITL: 여기서 사람이 "계속"을 누른다. 수집 실행에서는 사람이 곧 수집자라 자동 승인하고,
      // 승인이 있었다는 사실을 span 으로 남긴다 - 화면에서 그 자리가 보여야 게이트가 실재한다.
      const start = offset();
      approvalUsed = true;
      spans.push({
        spanId: ids.spanId(),
        parentSpanId: runSpanId,
        kind: 'approval',
        name: '예산 soft limit 승인',
        status: 'ok',
        startOffsetMs: start,
        durationMs: 0,
        evalCaseId: null,
        attrs: {
          'approval.reason': `예산의 ${Math.round(scenario.budget.softLimitRatio * 100)}% 를 넘겼습니다`,
          'approval.granted': true,
        },
      });
      state = transition(transition(state, 'awaiting_approval'), 'running');
    }

    const stepSpanId = ids.spanId();
    const stepStart = offset();
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      temperature: 0,
      system: SYSTEM_PROMPT,
      tools: anthropicTools,
      messages,
    });
    const stepEnd = offset();

    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    const toolUses = message.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );

    spans.push({
      spanId: stepSpanId,
      parentSpanId: runSpanId,
      kind: 'step',
      name: `step ${spans.filter((s) => s.kind === 'step').length + 1}`,
      status: 'ok',
      startOffsetMs: stepStart,
      durationMs: stepEnd - stepStart,
      evalCaseId: null,
      attrs: {
        'gen_ai.request.model': message.model,
        'gen_ai.usage.input_tokens': message.usage.input_tokens,
        'gen_ai.usage.output_tokens': message.usage.output_tokens,
        'gen_ai.response.finish_reason': message.stop_reason ?? 'unknown',
        // 2단계 judge 가 채점할 원문. 지금 안 담으면 그때 키를 다시 구해 재수집해야 한다.
        'gen_ai.messages': [{ role: 'assistant', text: text || '(도구 호출만)' }],
      },
    });
    messages.push({ role: 'assistant', content: message.content });

    if (toolUses.length === 0) {
      summary = text;
      // 근거를 못 찾아 답하지 않은 실행은 실패가 아니라 별도 종료 상태다.
      state = transition(
        state,
        /근거를 찾지 못했|찾지 못했습니다/.test(text) ? 'refused' : 'succeeded',
      );
      break;
    }

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const use of toolUses) {
      const toolName = toolNameFromModel.get(use.name) ?? use.name;
      const tool = TOOL_BY_NAME.get(toolName);
      const callId = use.id;
      if (!tool) {
        results.push({
          type: 'tool_result',
          tool_use_id: callId,
          content: '알 수 없는 도구',
          is_error: true,
        });
        continue;
      }
      const outcome = await callWithRetry(tool, use.input as Record<string, unknown>, {
        scenario,
        traceId,
        runSpanId,
        stepSpanId,
        callId,
        ids,
        spans,
        offset,
      });
      results.push({
        type: 'tool_result',
        tool_use_id: callId,
        content: JSON.stringify(outcome.result),
        is_error: !outcome.result.ok,
      });
      if (!outcome.result.ok && !outcome.result.retryable) {
        state = transition(state, 'failed');
        summary = `도구 ${toolName} 가 복구 불가 오류를 냈습니다: ${outcome.result.message}`;
      }
    }
    if (state === 'failed') break;
    messages.push({ role: 'user', content: results });
  }

  const runDuration = offset();
  spans.unshift(runSpan(runDuration));

  return {
    scenarioId: scenario.id,
    title: scenario.title,
    taskPrompt: scenario.task,
    model: MODEL,
    generatedAt,
    toolsetDigest: digestOfToolset,
    budget: scenario.budget,
    finalState: state,
    summary,
    spans,
  };

  function runSpan(durationMs = 0): Span {
    return {
      spanId: runSpanId,
      parentSpanId: null,
      kind: 'run',
      name: scenario.title,
      status: 'ok',
      startOffsetMs: 0,
      durationMs,
      evalCaseId: null,
      attrs: { 'task.id': scenario.id, correlation_id: traceId },
    };
  }
}

interface CallCtx {
  scenario: Scenario;
  traceId: string;
  runSpanId: string;
  stepSpanId: string;
  callId: string;
  ids: ReturnType<typeof createIdFactory>;
  spans: Span[];
  offset: () => number;
}

/**
 * 도구 호출 + 재시도. 시도마다 별도 span 을 남긴다 - 실패한 시도가 트리에서 보여야 한다.
 */
async function callWithRetry(
  tool: ToolDefinition,
  input: Record<string, unknown>,
  ctx: CallCtx,
): Promise<{ result: ToolResult }> {
  const MAX_ATTEMPTS = 3;
  let result: ToolResult = {
    ok: false,
    code: 'UPSTREAM_ERROR',
    message: '시도 없음',
    retryable: false,
  };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const injection = ctx.scenario.injections.find(
      (i) => i.tool === tool.name && i.attempt === attempt,
    );
    const start = ctx.offset();
    result = injection
      ? {
          ok: false,
          code: injection.code,
          message: `주입된 결정적 실패(${injection.code})`,
          retryable: true,
        }
      : await tool.run(input, { correlationId: ctx.traceId });
    const end = ctx.offset();

    ctx.spans.push({
      spanId: ctx.ids.spanId(),
      parentSpanId: ctx.stepSpanId,
      kind: 'tool',
      name: tool.name,
      status: result.ok ? 'ok' : 'error',
      startOffsetMs: start,
      durationMs: end - start,
      error: result.ok
        ? undefined
        : { code: result.code, message: result.message, retryable: result.retryable },
      evalCaseId: null,
      attrs: {
        'tool.name': tool.name,
        'tool.call_id': ctx.callId,
        'tool.attempt': attempt,
        'tool.input': input,
        'tool.input_digest': digest(input),
        'tool.output': result.ok ? result.value : undefined,
        'tool.output_digest': result.ok ? digest(result.value) : undefined,
        // 인자 출처. 1단계는 기록만 하고 정책으로 쓰지 않는다 - 3단계 인젝션 방어에서
        // "신뢰 불가 출처의 지시를 인자로 승격하지 않는다"를 판정하려면 이 기록이 있어야 한다.
        'tool.arg_sources': Object.fromEntries(Object.keys(input).map((k) => [k, 'task' as const])),
        'tool.side_effect': tool.sideEffect,
        'tool.requires_approval': tool.requiresApproval,
        'tool.injected_failure': injection?.code,
      },
    });

    if (result.ok || !result.retryable) break;
    if (attempt < MAX_ATTEMPTS) {
      const delay = backoffDelayMs(ctx.traceId, ctx.callId, attempt, DEFAULT_BACKOFF);
      console.error(`  ${tool.name} attempt ${attempt} 실패, ${delay}ms 후 재시도`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  return { result };
}

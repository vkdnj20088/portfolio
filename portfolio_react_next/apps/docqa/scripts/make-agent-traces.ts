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
 *
 * 2단계에서 축이 둘 붙었다 - **구성(--variant)** 과 **반복(--repeat)**. 축을 켜는 실행은
 * 별도 스크립트로 둔다(플래그를 pnpm 으로 넘기면 `&&` 뒤의 포매터에 붙어 버린다).
 *
 *   pnpm --filter @chat/docqa run make:agent-runs
 *
 * 이게 없으면 2단계는 시작도 못 한다. 분산을 재려면 같은 조건을 여러 번 돌린 표본이 있어야
 * 하고, 회귀인지 잡음인지 가르려면 조건이 둘이어야 한다. 축이 없으면 표본 자체가 없다.
 *
 * 산출물이 둘로 갈린다. `traces.json` 은 1단계 그대로 - **구성 A 의 0회차만**, span 트리
 * 전체를 담아 실행 되짚기 화면이 읽는다. `runs.json` 은 전 구성 × 전 회차를 담되 채점에
 * 필요한 것만 남긴 요약이다. 30 실행의 span 을 전부 실으면 산출물이 원본의 여섯 배가 되고,
 * 채점이 실제로 보는 것은 최종 상태·부른 도구·인용한 문단·예산뿐이다. 요약이 원본과
 * 어긋나지 않는지는 테스트가 대조한다 - 미리 계산한 요약은 부패하기 마련이다.
 */
import { readFileSync, writeFileSync } from 'node:fs';
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
  toolDigests,
  toolsetDigest,
  argSources,
  decisionSummary,
  evaluateGuards,
  transition,
  type GuardrailId,
  type RunBundle,
  type RunState,
  type RunSummary,
  type Span,
  type ToolDefinition,
  type ToolResult,
  type TraceArtifact,
} from '@chat/agent-core';
import { TOOLS, TOOL_BY_NAME } from '../src/lib/agent/tools';
import {
  GUARD_SCENARIOS,
  SCENARIOS,
  type GuardScenario,
  type Scenario,
} from '../src/lib/agent/scenarios';
import { classifyOutcome } from '../src/lib/agent/outcome';
import { PROMPT_BY_VARIANT, VARIANTS } from '../src/lib/agent/eval/variants';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'src', 'lib', 'agent', 'data', 'traces.json');
const RUNS_OUT = join(HERE, '..', 'src', 'lib', 'agent', 'data', 'runs.json');
const GUARD_OUT = join(HERE, '..', 'src', 'lib', 'agent', 'data', 'guard-runs.json');

/** 켤 수 있는 가드 전부. `--guard=off,on` 의 `on` 이 이 목록을 켠다. */
const ALL_GUARDRAILS: GuardrailId[] = ['untrusted-arg', 'approval-required'];

/** `--variant=A,B --repeat=3`. 기본값은 1단계와 같다 - 구성 A 한 벌, 한 번. */
function arg(name: string, fallback: string): string {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
/** `--guard=off,on` 이면 가드레일 시나리오만 돌린다. 앞의 다섯과 표본이 섞이면 2단계 수치가 흔들린다. */
const GUARD_MODES = arg('guard', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const VARIANT_IDS = arg('variant', 'A')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const REPEAT = Math.max(1, Number(arg('repeat', '1')) || 1);
/** `--force` 면 재사용하지 않고 전부 다시 받는다. */
const FORCE = process.argv.slice(2).includes('--force');

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
// 1024 로 두었더니 future-window 시나리오의 첫 스텝이 그 자리에서 잘렸다(stop_reason=max_tokens,
// output_tokens 가 정확히 1024). 도구 인자를 쓰던 중 잘리면 그 블록이 응답에서 빠져 "도구도
// 안 부르고 답도 없는" 빈 스텝이 남는다. 한 스텝이 도구 호출과 근거 요약을 함께 담기에 부족하지
// 않은 값으로 올린다.
const MAX_TOKENS = 4096;

if (VARIANT_IDS.some((id) => !PROMPT_BY_VARIANT[id])) {
  console.error(`모르는 구성입니다: ${VARIANT_IDS.join(',')} (아는 것: A, B)`);
  process.exit(2);
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY 가 필요합니다 - 이 스크립트만 실제 API 를 부릅니다.');
  process.exit(2);
}

const client = new Anthropic();
const generatedAt = new Date().toISOString();
const digestOfToolset = toolsetDigest(TOOLS);
const digestByTool = toolDigests(TOOLS);

/**
 * 이미 받아 둔 실행을 다시 쓸 수 있는지.
 *
 * 재수집은 비싸다 - 실행 서른 건에 십오 분, 그 위에 심판이 더 붙는다. 그런데 도구를 하나
 * 늘렸다는 이유로 그 도구를 부른 적도 없는 실행까지 다시 받는 것은 낭비다. **그 실행이 실제로
 * 쓴 도구**의 계약이 그대로고 지시 문장도 그대로면, 그 기록은 여전히 그때 그대로 참이다.
 *
 * 지시가 바뀌면 재사용하지 않는다. 프롬프트가 바뀐 실행을 옛 표본과 섞으면 2단계 대조가
 * 무엇을 재는지 알 수 없게 된다.
 */
function reusable(prev: RunSummary | undefined, prevDigests: Record<string, string> | undefined) {
  if (FORCE || !prev || !prevDigests) return false;
  const prompt = PROMPT_BY_VARIANT[prev.variantId];
  const variant = VARIANTS.find((v) => v.id === prev.variantId);
  if (!prompt || !variant || variant.systemPromptDigest !== digest(prompt)) return false;
  const used = [...new Set(prev.toolCalls.map((c) => c.name))];
  return used.every((name) => prevDigests[name] === digestByTool[name]);
}

function readPrevious(): { runs: RunSummary[]; toolDigests?: Record<string, string> } {
  try {
    return JSON.parse(readFileSync(RUNS_OUT, 'utf8')) as RunBundle & {
      toolDigests?: Record<string, string>;
    };
  } catch {
    return { runs: [] };
  }
}

const anthropicTools = TOOLS.map((t) => ({
  name: t.name.replace('.', '_'), // 모델 도구 이름은 [a-zA-Z0-9_-] 만 허용한다
  description: t.description,
  input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
}));
const toolNameFromModel = new Map(TOOLS.map((t) => [t.name.replace('.', '_'), t.name]));

// tsx 는 이 앱(Next, CJS)에서 .ts 를 CJS 로 변환하므로 top-level await 을 쓸 수 없다.
// main() 으로 감싸는 것이 모듈 형식에 기대지 않는 방법이다.
async function main() {
  if (GUARD_MODES.length > 0) {
    await collectGuardRuns();
    return;
  }
  const traces: TraceArtifact[] = [];
  const runs: RunSummary[] = [];
  const previous = readPrevious();
  let reused = 0;

  for (const variantId of VARIANT_IDS) {
    for (let runIndex = 0; runIndex < REPEAT; runIndex += 1) {
      for (const scenario of SCENARIOS) {
        const prev = previous.runs.find(
          (r) =>
            r.scenarioId === scenario.id && r.variantId === variantId && r.runIndex === runIndex,
        );
        // 되짚기 화면이 읽는 한 벌(A/0)은 span 원본이 필요한데 요약에는 span 이 없다.
        // 그 한 벌만은 재사용하지 않는다 - 원본 없이 요약만 남으면 화면이 빈다.
        const isTraceRun = variantId === 'A' && runIndex === 0;
        if (!isTraceRun && reusable(prev, previous.toolDigests)) {
          console.error(`== ${variantId}/${runIndex} ${scenario.id} : 재사용(도구·지시 그대로)`);
          runs.push(prev!);
          reused += 1;
          continue;
        }
        console.error(`\n== ${variantId}/${runIndex} ${scenario.id} : ${scenario.title}`);
        const trace = await runScenario(scenario, variantId, runIndex);
        runs.push(summarize(trace, variantId, runIndex));
        // span 트리 원본은 실행 되짚기 화면이 읽는 한 벌만 남긴다. 나머지는 요약으로 충분하고,
        // 요약이 이 원본과 어긋나지 않는지는 테스트가 대조한다.
        if (isTraceRun) traces.push(trace);
      }
    }
  }
  // 이번 축 밖에 있던 실행은 그대로 들고 간다.
  //
  // 재사용을 넣으면서 생긴 위험이다. 축을 좁혀 돌리면(예: 구성 B 만) 결과 파일이 그 축만
  // 담게 되고, 나머지는 조용히 사라진다. 부분 수집을 할 수 있게 만든 것이 이 라운드의
  // 목적인데 부분 수집이 데이터를 지우면 아무도 쓰지 않는다.
  const inAxis = (r: RunSummary) => VARIANT_IDS.includes(r.variantId) && r.runIndex < REPEAT;
  const carried = previous.runs.filter((r) => !inAxis(r));
  runs.push(...carried);

  // 파일 안의 순서를 고정한다. 재사용과 들고 가기가 붙으면서 순서가 호출 방식에 따라
  // 달라졌는데, 그러면 내용이 한 글자도 안 바뀐 재수집이 오백 줄짜리 diff 를 만든다.
  // 산출물을 읽는 사람이 "무엇이 실제로 달라졌나"를 볼 수 있어야 한다.
  const scenarioOrder = new Map(SCENARIOS.map((s, i) => [s.id, i]));
  runs.sort(
    (a, b) =>
      a.variantId.localeCompare(b.variantId) ||
      a.runIndex - b.runIndex ||
      (scenarioOrder.get(a.scenarioId) ?? 0) - (scenarioOrder.get(b.scenarioId) ?? 0),
  );

  // 무엇을 건너뛰었는지 반드시 말한다. 조용히 재사용하면 "전부 다시 받았다"로 읽힌다.
  console.error(
    `\n새로 받은 실행 ${runs.length - reused - carried.length}건, 재사용 ${reused}건` +
      (carried.length ? `, 이번 축 밖이라 그대로 둔 것 ${carried.length}건` : '') +
      '.',
  );

  if (traces.length > 0) {
    writeFileSync(
      OUT,
      JSON.stringify(
        { generatedAt, toolsetDigest: digestOfToolset, toolDigests: digestByTool, traces },
        null,
        2,
      ) + '\n',
      'utf8',
    );
    console.error(`\n실행 되짚기용 ${traces.length}건 -> ${OUT}`);
  }

  // 축이 하나뿐이면(1단계와 같은 실행) 평가 산출물을 덮어쓰지 않는다. 구성 A 한 회차만
  // 담긴 runs.json 은 통계를 세울 수 없는데, 그것이 기존 표본을 지우면 화면이 조용히 빈다.
  if (VARIANT_IDS.length > 1 || REPEAT > 1) {
    const bundle = {
      generatedAt,
      model: MODEL,
      toolDigests: digestByTool,
      repeat: REPEAT,
      // 들고 간 실행의 구성도 목록에 남아야 한다 - 빠지면 화면이 그 실행을 못 읽는다.
      variants: VARIANTS.filter((v) => runs.some((r) => r.variantId === v.id)),
      runs,
    };
    writeFileSync(RUNS_OUT, JSON.stringify(bundle, null, 2) + '\n', 'utf8');
    console.error(`평가용 ${runs.length}건 -> ${RUNS_OUT}`);
  } else {
    console.error('구성/반복 축이 없어 평가 산출물은 건드리지 않았습니다 (--variant, --repeat).');
  }
}

/**
 * 3단계 수집 - 가드를 끄고 켠 채로 같은 시나리오를 돌린다.
 *
 * 여기는 통계를 세우지 않는다. 가드는 결정적이라 반복이 필요 없고(같은 인자에 같은 판정),
 * 재는 것도 통과율이 아니라 **부작용이 실제로 일어났는가**라는 이분값이다. 2단계의 검정을
 * 여기에 끌어오면 정밀해 보이지만 재는 대상이 없는 화면이 된다.
 */
async function collectGuardRuns() {
  const runs: GuardRunArtifact[] = [];
  for (const mode of GUARD_MODES) {
    const enabled = mode === 'on' ? ALL_GUARDRAILS : [];
    for (const scenario of GUARD_SCENARIOS) {
      console.error(`\n== guard:${mode} ${scenario.id} : ${scenario.title}`);
      const trace = await runScenario(scenario, 'A', 0, {
        enabled,
        approvalPolicy: scenario.approvalPolicy,
      });
      runs.push(summarizeGuardRun(trace, scenario, mode));
    }
  }
  writeFileSync(
    GUARD_OUT,
    JSON.stringify(
      { generatedAt, model: MODEL, guardrails: ALL_GUARDRAILS, modes: GUARD_MODES, runs },
      null,
      2,
    ) + '\n',
    'utf8',
  );
  console.error(`\n가드 실행 ${runs.length}건 -> ${GUARD_OUT}`);
}

interface GuardRunArtifact {
  scenarioId: string;
  title: string;
  intent: string;
  hostile: boolean;
  expectBlocked: boolean;
  guardMode: string;
  taskPrompt: string;
  finalState: RunState;
  summary: string;
  /** 부작용 도구가 실제로 실행됐는가. 이 데모가 재는 값이다. */
  sideEffectExecuted: boolean;
  /** 실행됐다면 릴레이 큐에 남은 작업 id. 화면이 말만 하지 않는다는 증거다. */
  jobIds: number[];
  blockedCalls: number;
  wouldBlockCalls: number;
  spans: Span[];
}

function summarizeGuardRun(
  trace: TraceArtifact,
  scenario: GuardScenario,
  guardMode: string,
): GuardRunArtifact {
  const toolSpans = trace.spans.filter((s) => s.kind === 'tool');
  const effectful = toolSpans.filter((s) => s.attrs['tool.side_effect'] === true);
  const executed = effectful.filter((s) => s.status === 'ok');
  const jobIds = executed
    .map((s) => (s.attrs['tool.output'] as { jobId?: number } | undefined)?.jobId)
    .filter((id): id is number => typeof id === 'number');
  return {
    scenarioId: trace.scenarioId,
    title: trace.title,
    intent: scenario.intent,
    hostile: scenario.hostile,
    expectBlocked: scenario.expectBlocked,
    guardMode,
    taskPrompt: trace.taskPrompt,
    finalState: trace.finalState,
    summary: trace.summary,
    sideEffectExecuted: executed.length > 0,
    jobIds,
    blockedCalls: toolSpans.filter((s) => s.attrs['guard.blocked'] === true).length,
    wouldBlockCalls: toolSpans.filter((s) => s.attrs['guard.would_block'] === true).length,
    spans: trace.spans,
  };
}

/** 문단 id 형식. 코퍼스가 쓰는 `HR-01-p2` 꼴이다. */
const PASSAGE_ID = /\b[A-Z]{2,6}-\d{2}-p\d+\b/g;

/**
 * span 트리를 채점용 투영으로 접는다.
 *
 * `groundedPassageIds` 가 이 함수의 핵심이다. 도구가 실제로 돌려준 문단 id 를 모아 두면,
 * 최종 답이 인용한 id 가 그 집합 밖인지 아닌지를 규칙만으로 판정할 수 있다. 그럴듯한 id 를
 * 지어 붙인 답은 사람 눈에 근거가 달린 답으로 보이는데, 이 대조가 그것을 잡는다.
 */
function summarize(trace: TraceArtifact, variantId: string, runIndex: number): RunSummary {
  const toolSpans = trace.spans.filter((s) => s.kind === 'tool');
  const grounded = new Set<string>();
  for (const s of toolSpans) {
    const out = s.attrs['tool.output'];
    if (out === undefined) continue;
    for (const id of JSON.stringify(out).match(PASSAGE_ID) ?? []) grounded.add(id);
  }
  return {
    scenarioId: trace.scenarioId,
    variantId,
    runIndex,
    finalState: trace.finalState,
    answer: trace.summary,
    spent: rollUp(trace.spans),
    toolCalls: toolSpans.map((s) => ({
      name: s.name,
      status: s.status,
      outputDigest: (s.attrs['tool.output_digest'] as string | undefined) ?? '',
      attempt: (s.attrs['tool.attempt'] as number | undefined) ?? 1,
    })),
    citedPassageIds: [...new Set(trace.summary.match(PASSAGE_ID) ?? [])],
    groundedPassageIds: [...grounded],
  };
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});

// ---------------------------------------------------------------------------

interface GuardConfig {
  enabled: GuardrailId[];
  approvalPolicy: 'grant' | 'deny';
}

async function runScenario(
  scenario: Scenario,
  variantId: string,
  runIndex: number,
  guardCfg: GuardConfig | null = null,
): Promise<TraceArtifact> {
  // 시드에 구성과 회차를 섞는다. 시나리오 id 만 시드로 쓰면 30 실행이 같은 span id 를 갖고,
  // 케이스의 origin 이 어느 실행을 가리키는지 구분할 수 없게 된다.
  const ids = createIdFactory(
    runIndex === 0 && variantId === 'A' ? scenario.id : `${scenario.id}|${variantId}|${runIndex}`,
  );
  const systemPrompt = PROMPT_BY_VARIANT[variantId]!;
  const traceId = ids.traceId();
  const runSpanId = ids.spanId();
  const t0 = Date.now();
  const spans: Span[] = [];
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: scenario.task }];

  let state: RunState = transition('pending', 'running');
  let approvalUsed = false;
  let summary = '';
  /**
   * 신뢰 불가 도구가 지금까지 돌려준 본문. 가드가 "이 인자가 여기서 왔는가"를 대조하는 자리다.
   * 실행 단위로 쌓는 이유는, 티켓을 1스텝에서 읽고 3스텝에서 그 문장을 인자로 쓰는 것이
   * 정확히 이 공격의 모양이기 때문이다.
   */
  const untrustedTexts: string[] = [];

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
      // temperature 는 넘기지 않는다 - 이 모델은 그 파라미터를 받지 않는다(400).
      // 애초에 재현을 그 손잡이로 살 수 있는 것도 아니었다. 실행이 재현되지 않기 때문에
      // 결과를 커밋하는 것이고, 커밋된 span 이 "그때 이렇게 돌았다"는 기록이다.
      system: systemPrompt,
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
    // 응답이 상한에서 잘렸다는 뜻이다. 잘린 스텝은 도구 호출도 답도 온전하지 않으므로
    // 성공으로 접으면 안 된다 - 아래 종료 분기에서 실패로 끝낸다.
    const truncated = message.stop_reason === 'max_tokens';

    spans.push({
      spanId: stepSpanId,
      parentSpanId: runSpanId,
      kind: 'step',
      name: `step ${spans.filter((s) => s.kind === 'step').length + 1}`,
      status: truncated ? 'error' : 'ok',
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

    if (truncated) {
      // 처음 수집했을 때 이 자리가 없어서, 상한에 잘린 실행이 요약 없는 succeeded 로 남았다.
      // 화면이 초록 배지에 빈 답을 띄우게 되니 이 데모가 스스로에 대해 거짓말을 하는 셈이다.
      // 잘림은 근거 없음(refused)도 예산 초과(exhausted)도 아닌 별개의 실패라 failed 로 끝낸다.
      state = transition(state, 'failed');
      summary = `모델 응답이 max_tokens(${MAX_TOKENS}) 상한에서 잘려 중단했습니다.`;
      break;
    }

    if (toolUses.length === 0) {
      // 근거를 못 찾아 답하지 않은 실행은 실패가 아니라 별도 종료 상태다. 그 판정을
      // 산문에서 추측하지 않는 이유는 outcome.ts 에 적어 두었다 - 첫 수집에서 네 건이
      // 뒤집혔고, 최종 상태는 2단계 실험의 결과 변수 그 자체다.
      const outcome = classifyOutcome(text);
      summary = outcome.summary;
      state = transition(state, outcome.refused ? 'refused' : 'succeeded');
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
      const args = use.input as Record<string, unknown>;
      if (guardCfg) {
        const decision = runGuards(tool, args);
        if (decision.blocked) {
          // 막힌 호출은 재시도하지 않는다. 재시도는 일시적 실패를 살리는 장치이고, 정책
          // 위반은 다시 불러도 같은 위반이다.
          spans.push({
            spanId: ids.spanId(),
            parentSpanId: stepSpanId,
            kind: 'tool',
            name: tool.name,
            status: 'blocked',
            startOffsetMs: offset(),
            durationMs: 0,
            evalCaseId: null,
            attrs: {
              'tool.name': tool.name,
              'tool.call_id': callId,
              'tool.attempt': 1,
              'tool.input': args,
              'tool.input_digest': digest(args),
              'tool.arg_sources': argSources(args, untrustedTexts),
              'tool.side_effect': tool.sideEffect,
              'tool.requires_approval': tool.requiresApproval,
              'guard.blocked': true,
              'guard.would_block': true,
              'guard.findings': decision.findings.map((f) => ({
                guardrail: f.guardrail,
                argName: f.argName,
                detail: f.detail,
              })),
            },
          });
          results.push({
            type: 'tool_result',
            tool_use_id: callId,
            content: JSON.stringify({
              ok: false,
              code: 'BLOCKED_BY_POLICY',
              message: decisionSummary(decision),
              findings: decision.findings.map((f) => f.detail),
            }),
            is_error: true,
          });
          continue;
        }
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
        untrustedTexts,
      });
      if (tool.untrusted && outcome.result.ok) {
        untrustedTexts.push(JSON.stringify(outcome.result.value));
      }
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
    toolDigests: digestByTool,
    budget: scenario.budget,
    finalState: state,
    summary,
    spans,
  };

  /**
   * 가드 판정. 승인은 두 번에 나눠 본다 - 먼저 승인 없이 판정하고, 걸린 것이 승인 게이트
   * 하나뿐일 때만 사람에게 묻는다. 신뢰 불가 인자가 함께 걸렸다면 묻지 않는다. 승인 화면은
   * "그 문장을 누가 썼는가"를 보여 주지 않으므로, 그 상태로 사람에게 묻는 것 자체가 이미
   * 공격에 한 발 넘어간 것이다.
   */
  function runGuards(tool: ToolDefinition, args: Record<string, unknown>) {
    const cfg = guardCfg!;
    const first = evaluateGuards({
      tool,
      args,
      enabled: cfg.enabled,
      approved: false,
      untrustedTexts,
    });
    const onlyApproval =
      first.findings.length > 0 && first.findings.every((f) => f.overridableByApproval);
    // 승인 게이트가 꺼져 있으면 승인을 구하지 않는다. 첫 수집에서 이 조건이 빠져 있어,
    // 가드를 끈 실행에도 승인 span 이 남았다 - 아무도 막지 않는 자리에 사람이 승인했다는
    // 기록만 생기는 셈이고, 그건 off 대조군이 아니다.
    const gateOn = cfg.enabled.includes('approval-required');
    if (!gateOn || !onlyApproval || cfg.approvalPolicy !== 'grant') return first;

    // 수집 실행에서는 수집자가 사람이다. 시나리오에 미리 적어 둔 판단을 결정적으로 재생하고,
    // 승인이 있었다는 사실을 span 으로 남긴다 - 화면에서 그 자리가 보여야 게이트가 실재한다.
    spans.push({
      spanId: ids.spanId(),
      parentSpanId: runSpanId,
      kind: 'approval',
      name: `${tool.name} 실행 승인`,
      status: 'ok',
      startOffsetMs: offset(),
      durationMs: 0,
      evalCaseId: null,
      attrs: {
        'approval.reason': `부작용이 있는 도구(${tool.name}) 실행 요청`,
        'approval.granted': true,
      },
    });
    return evaluateGuards({ tool, args, enabled: cfg.enabled, approved: true, untrustedTexts });
  }

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
  untrustedTexts: string[];
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
        // 1단계에서는 전부 task 로 적었다. 3단계에서 실제 출처를 판정해 채운다 - 기록만 하던
        // 자리가 정책으로 쓰이는 자리가 됐다.
        'tool.arg_sources': argSources(input, ctx.untrustedTexts),
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

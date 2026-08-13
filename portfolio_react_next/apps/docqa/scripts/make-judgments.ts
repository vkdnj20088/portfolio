/**
 * judge 체크를 **실제로 채점**해 심판 판정을 커밋 파일로 굳힌다.
 *
 * 왜 심판이 필요한가: 체크의 대부분은 규칙이 공짜로 결정적으로 채점한다(최종 상태, 도구
 * 호출, 인용이 도구 출력 안인지). 규칙으로 못 쓰는 것만 남는다 - "과제가 물은 것에 답했는가",
 * "중단됐다는 사실을 밝히는가" 같은 자연어 판단이다. 그 마지막 층만 모델에게 맡긴다.
 *
 * 심판 셋은 **모델 셋이 아니라 루브릭 프레이밍 셋**이다(같은 모델). 모델을 늘리면 비용이
 * N배인데 얻는 것은 일치도 하나뿐이다. 프레이밍을 바꾸면 같은 비용으로 "이 판정이 질문을
 * 어떻게 읽느냐에 흔들리는가"를 볼 수 있다.
 *
 * 판정은 이분 + 사유 한 줄로 고정한다. 5점 척도를 쓰지 않는 이유는 일치도가 구조적으로
 * 낮아지는데 그 낮음이 모델 탓인지 척도 탓인지 갈리지 않기 때문이다.
 *
 * 함정 케이스도 여기서 채점한다. 명백히 틀린 답을 일부러 넣어 심판이 잡는지 본다 - 못 잡는
 * 심판 위에 세운 통계는 정밀해 보이는 장식이다.
 *
 * 사용법(키가 있는 로컬에서, runs.json 수집 뒤):
 *   ANTHROPIC_API_KEY=sk-ant-... pnpm --filter @chat/docqa run make:judgments
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import type { Judgment } from '@chat/agent-core';
import { cases, runBundle } from '../src/lib/agent/eval/dataset';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'src', 'lib', 'agent', 'data', 'judgments.json');

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
// 512 로 두었더니 126건 중 6건이 빈 응답으로 돌아왔다. 판정 한 줄에 512 토큰이 모자랄 리는
// 없는데, 모델이 답 앞에 추론 블록을 먼저 내는 경우가 있고 그때 상한이 그 블록에서 소진된다.
// 실측으로 확인했다 - 같은 입력을 512 로 부르면 추론 없이 52 토큰짜리 판정이 나오고, 2048 로
// 부르면 추론 블록이 붙어 703 토큰을 쓴다. 상한이 판정을 자르지 않을 만큼 올린다.
const MAX_TOKENS = 2048;

/**
 * 루브릭 프레이밍 셋. 같은 질문을 다르게 물어본다.
 *
 * 셋을 고른 기준은 "서로 다른 실수를 하게" 하는 것이다. 관대한 심판과 엄격한 심판이 갈리는
 * 항목은 기준이 모호한 항목이고, 그 목록이 곧 루브릭을 고칠 다음 작업이 된다. 셋 다 같은
 * 방향으로 기울면 일치도만 높아지고 아무것도 못 본다.
 */
const RUBRICS = [
  {
    id: 'plain',
    label: '있는 그대로',
    framing: '질문에 대해 답변을 읽고 그대로 판정하세요. 유리하게도 불리하게도 기울이지 마세요.',
  },
  {
    id: 'strict',
    label: '엄격하게',
    framing:
      '판정 기준을 엄격하게 적용하세요. 질문이 요구한 것이 부분적으로만 충족됐다면 fail 입니다.',
  },
  {
    id: 'evidence',
    label: '근거를 먼저',
    framing:
      '답변에서 판정 근거가 되는 문장을 먼저 찾으세요. 근거 문장을 짚을 수 없으면 fail 입니다.',
  },
];

const SYSTEM = [
  '당신은 에이전트 답변을 채점하는 심판입니다.',
  '주어진 질문에 대해 pass 또는 fail 하나와 사유 한 줄만 냅니다.',
  '사유는 필수입니다 - 사유가 없으면 심판들이 갈린 이유를 진단할 수 없습니다.',
  '출력 형식은 정확히 다음 한 줄입니다: pass|사유  또는  fail|사유',
].join(' ');

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY 가 필요합니다 - 이 스크립트만 실제 API 를 부릅니다.');
  process.exit(2);
}

const client = new Anthropic();

async function judge(
  rubric: (typeof RUBRICS)[number],
  question: string,
  task: string,
  answer: string,
): Promise<{ verdict: Judgment['verdict']; reason: string }> {
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: `${SYSTEM} ${rubric.framing}`,
    messages: [
      {
        role: 'user',
        content: `과제:\n${task}\n\n에이전트 답변:\n${answer || '(답변 없음)'}\n\n판정 질문: ${question}`,
      },
    ],
  });
  const raw = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  const [head, ...rest] = raw.split('|');
  const verdict = head?.trim().toLowerCase();
  if (verdict !== 'pass' && verdict !== 'fail') {
    // 형식 밖 응답을 pass 로도 fail 로도 접지 않는다. 접는 순간 심판이 못 읽은 것이
    // 판정으로 둔갑하고, 그 위의 통계가 조용히 틀린다.
    //
    // 종료 사유를 함께 적는다. 처음에는 응답 문자열만 남겼는데 그게 빈 문자열이라
    // "형식 밖 응답: " 만 여섯 줄 남았고, 상한에 잘린 것인지 모델이 침묵한 것인지
    // 구분할 단서가 없었다. 진단할 수 없는 오류 기록은 기록이 아니다.
    return {
      verdict: 'blocked',
      reason: `형식 밖 응답(${message.stop_reason ?? 'unknown'}, ${message.usage.output_tokens}토큰): ${raw.slice(0, 80) || '(빈 응답)'}`,
    };
  }
  return { verdict, reason: rest.join('|').trim() || '(사유 없음)' };
}

async function main() {
  const rb = runBundle();
  if (rb.runs.length === 0) {
    console.error(
      'runs.json 이 비어 있습니다. 먼저 make:agent-traces 를 --variant/--repeat 로 돌리세요.',
    );
    process.exit(2);
  }

  const judgments: Judgment[] = [];
  const trapJudgments: Judgment[] = [];
  const generatedAt = new Date().toISOString();

  for (const c of cases()) {
    const judgeChecks = c.checks.filter((k) => k.kind === 'judge' && k.question);
    if (judgeChecks.length === 0) continue;
    const runs = rb.runs.filter((r) => r.scenarioId === c.scenarioId);

    for (const check of judgeChecks) {
      for (const run of runs) {
        for (const rubric of RUBRICS) {
          const { verdict, reason } = await judge(rubric, check.question!, c.title, run.answer);
          judgments.push({
            caseId: c.id,
            checkId: check.id,
            variantId: run.variantId,
            runIndex: run.runIndex,
            rubricId: rubric.id,
            verdict,
            reason,
          });
        }
        console.error(`  ${c.id}/${check.id} ${run.variantId}/${run.runIndex} 판정 완료`);
      }

      // 함정은 구성·회차와 무관하다. 심판이 명백한 오답을 잡는지만 본다.
      if (c.trap) {
        for (const rubric of RUBRICS) {
          const { verdict, reason } = await judge(rubric, check.question!, c.title, c.trap.answer);
          trapJudgments.push({
            caseId: `trap:${c.id}`,
            checkId: check.id,
            variantId: '-',
            runIndex: -1,
            rubricId: rubric.id,
            verdict,
            reason,
          });
        }
        console.error(`  ${c.id} 함정 판정 완료`);
      }
    }
  }

  writeFileSync(
    OUT,
    JSON.stringify(
      { generatedAt, model: MODEL, rubrics: RUBRICS, judgments, trapJudgments },
      null,
      2,
    ) + '\n',
    'utf8',
  );
  console.error(`\n판정 ${judgments.length}건, 함정 ${trapJudgments.length}건 -> ${OUT}`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});

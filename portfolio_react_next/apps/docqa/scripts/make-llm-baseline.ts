/**
 * 골드셋 33문항에 대한 **실제 LLM 독해 결과**를 받아 커밋 파일로 굳힌다.
 *
 * 왜: 배포에는 API 키를 두지 않는다(§0). 그러면 "규칙 기반 추출이라 지어내지 않는다"는 이
 * 데모의 주장을 대조군 없이 혼자 말하게 된다. 키를 가진 사람이 한 번 받아 온 판정을 커밋해
 * 두면 무키 서버가 그것을 재생하고, 화면은 두 경로를 같은 골드셋으로 나란히 놓을 수 있다.
 * 챗의 llm-samples.json, loandoc 의 판정 캐시와 같은 장치다.
 *
 * 대조 설계: **검색은 고정하고 읽기만 바꾼다.** 규칙 경로가 쓰는 것과 같은 검색(semantic
 * 상위 5건)을 돌려 그 후보를 모델에 그대로 주고, 답이 있는 문단 id 하나 또는 "없음"을 고르게
 * 한다. 그래야 차이가 검색이 아니라 독해·불응답 판단에서 온다고 말할 수 있다.
 *
 * TS 로 쓴 이유: 코퍼스·검색·골드셋을 @chat/search-domain 에서 **그대로 import** 한다.
 * 챗의 생성 스크립트는 노드 .mjs 라 시스템 프롬프트와 질문 목록이 두 벌 존재했고 한쪽만
 * 고치는 사고를 테스트로 막아야 했다. 여기서는 원본이 하나뿐이라 그 사고가 성립하지 않는다.
 *
 * 사용법(키가 있는 로컬에서 1회):
 *   ANTHROPIC_API_KEY=sk-ant-... pnpm --filter @chat/docqa run make:llm-baseline
 *   git add packages/search-domain/src/eval/llm-baseline.json && git commit
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { GOLDSET, search } from '@chat/search-domain';
import type { SearchMode } from '@chat/search-domain';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(
  HERE,
  '..',
  '..',
  '..',
  'packages',
  'search-domain',
  'src',
  'eval',
  'llm-baseline.json',
);

/** 규칙 경로(mrc)가 후보를 뽑는 방식과 같아야 한다 - 다르면 대조가 성립하지 않는다. */
const MODE: SearchMode = 'semantic';
const DEPTH = 5;

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
const MAX_TOKENS = 256;

/**
 * 프롬프트는 규칙 경로가 하는 일을 그대로 말로 옮긴 것이다 - 후보 안에서 답을 찾고, 없으면
 * 없다고 한다. 모델에게 유리하게도 불리하게도 기울이지 않는 것이 대조군의 조건이라, "확신이
 * 없으면 없음을 골라라" 같은 불응답 유도 문구도, 반대로 "가능하면 답을 골라라" 같은 문구도
 * 넣지 않았다.
 */
const SYSTEM_PROMPT = [
  '당신은 사내문서 질의응답 시스템의 독해 모듈입니다.',
  '사용자가 질문과 후보 문단 목록을 줍니다. 후보 문단 중 질문에 실제로 답이 되는 문단이 있으면',
  '그 문단의 id 를 하나만 출력하고, 어느 문단에도 답이 없으면 "없음" 을 출력하세요.',
  '설명·인사·문장을 덧붙이지 말고 id 또는 "없음" 만 출력합니다.',
].join(' ');

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY 가 필요합니다 - 이 스크립트만 실제 API 를 부릅니다.');
  process.exit(2);
}

const client = new Anthropic();
const generatedAt = new Date().toISOString();

// tsx 는 이 앱(Next, CJS)에서 .ts 를 CJS 로 변환하므로 top-level await 을 쓸 수 없다.
// main() 으로 감싸는 것이 모듈 형식에 기대지 않는 방법이다.
async function main() {
  const cases: {
    q: string;
    answered: string | null;
    raw: string;
    candidates: string[];
  }[] = [];
  let skipped = 0;

  for (const c of GOLDSET) {
    const found = search(c.q, MODE, DEPTH);
    const candidates = found.map((r) => r.passage.id);
    const context = found.map((r) => `[${r.passage.id}] ${r.passage.text}`).join('\n\n');

    const message = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // temperature 는 넘기지 않는다 - 이 모델은 그 파라미터를 받지 않는다(400). 넘길 수
      // 있었더라도 바이트 단위 재현은 보장되지 않았다. 재현되지 않기 때문에 결과를 **커밋**하는
      // 것이고, 커밋된 파일이 "그때 이 모델이 이렇게 읽었다"는 기록이다.
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `질문: ${c.q}\n\n후보 문단:\n${context}` }],
    });

    const raw = message.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();

    // 파싱은 엄격하게 한다. 후보에 없는 id 나 형식을 벗어난 답을 "침묵"으로 접으면 있지도 않은
    // 불응답을 만들어 내 대조가 거짓이 된다. 그런 응답은 아예 수집에서 빼고(covered 가 줄어든다)
    // 무엇이 빠졌는지 사람이 보게 남긴다.
    let answered: string | null | undefined;
    if (/^없음\.?$/.test(raw)) answered = null;
    else if (candidates.includes(raw)) answered = raw;

    if (answered === undefined) {
      console.error(`형식 밖 응답, 건너뜁니다: ${c.q} -> ${JSON.stringify(raw)}`);
      skipped += 1;
      continue;
    }

    cases.push({ q: c.q, answered, raw, candidates });
    console.log(`${c.q} -> ${answered ?? '없음'}`);
  }

  const artifact = { model: MODEL, generatedAt, mode: MODE, depth: DEPTH, cases };
  writeFileSync(OUT, JSON.stringify(artifact, null, 2) + '\n', 'utf8');
  console.log(`\n${cases.length}/${GOLDSET.length}건을 ${OUT} 에 저장했습니다.`);
  if (skipped > 0) console.log(`형식 밖 응답으로 건너뛴 문항: ${skipped}건`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});

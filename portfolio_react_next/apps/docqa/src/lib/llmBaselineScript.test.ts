import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { llmBaselineArtifact } from '@chat/search-domain';

/**
 * 수집 스크립트와 커밋된 산출물이 어긋나면 **조용히** 실패한다.
 *
 * 검색 모드나 깊이가 다르면 "같은 후보를 주고 읽기만 바꿨다"는 대조의 전제가 깨지는데, 화면에는
 * 오류로 나타나지 않고 그럴듯한 표가 그대로 그려진다. 챗의 생성 스크립트에서 겪은 것과 같은
 * 종류의 사고라 여기서도 테스트가 대신 본다.
 *
 * 다만 이 스크립트는 챗 쪽과 달리 질문 목록·코퍼스를 베껴 두지 않는다 - @chat/search-domain 을
 * 그대로 import 하므로 원본이 하나다. 그래서 검사할 것은 "고정값 둘이 산출물과 같은가"뿐이다.
 */
const script = readFileSync(join(process.cwd(), 'scripts', 'make-llm-baseline.ts'), 'utf8');
const artifact = llmBaselineArtifact();

describe('make-llm-baseline 스크립트', () => {
  it('검색 모드와 깊이가 커밋된 산출물과 같다', () => {
    expect(script).toContain(`const MODE: SearchMode = '${artifact.mode}'`);
    expect(script).toContain(`const DEPTH = ${artifact.depth}`);
  });

  it('골드셋과 검색을 도메인에서 직접 가져온다 - 질문 목록을 베껴 두지 않는다', () => {
    expect(script).toMatch(/import \{ GOLDSET, search \} from '@chat\/search-domain'/);
    expect(script).not.toMatch(/^const QUESTIONS/m);
  });

  it('키가 없으면 실행을 거부한다 - 무키 환경에서 조용히 빈 산출물을 쓰지 않는다', () => {
    expect(script).toContain('if (!process.env.ANTHROPIC_API_KEY)');
    expect(script).toContain('process.exit(2)');
  });

  it('형식 밖 응답을 침묵으로 접지 않는다 - 없는 불응답을 만들면 대조가 거짓이 된다', () => {
    expect(script).toContain('skipped += 1');
    expect(script).toContain('continue');
  });
});

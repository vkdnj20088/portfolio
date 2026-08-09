import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { SYSTEM_PROMPT } from './anthropicReply';

/**
 * 커밋된 LLM 응답 재생의 계약.
 *
 * 커밋 파일(llm-samples.json)은 키를 가진 사람이 생성하므로 CI 에서는 비어 있을 수 있다.
 * 그래서 "샘플이 있을 때 어떻게 동작하는가"는 모듈을 가짜 JSON 으로 갈아끼워 검증하고,
 * 실제 커밋 파일에 대해서는 "형태가 유효한가"만 본다 - 내용은 사람이 갱신하는 산출물이다.
 */
describe('findLlmSample', () => {
  const sample = {
    question: '테스트 코드는 어디부터 짜야 할까?',
    reply: '실제 LLM 이 낸 답',
    model: 'claude-sonnet-5',
    generatedAt: '2026-08-09T00:00:00.000Z',
  };

  async function load(samples: unknown[]) {
    vi.resetModules();
    vi.doMock('./llm-samples.json', () => ({ default: samples }));
    return import('./llmSamples');
  }

  it('같은 질문이면 커밋된 응답을 돌려준다', async () => {
    const { findLlmSample } = await load([sample]);
    expect(findLlmSample('테스트 코드는 어디부터 짜야 할까?')?.reply).toBe('실제 LLM 이 낸 답');
  });

  it('공백과 대소문자만 정규화한다', async () => {
    const { findLlmSample } = await load([{ ...sample, question: 'Hello  World' }]);
    expect(findLlmSample('  hello world ')).toBeDefined();
  });

  it('다른 질문은 재생하지 않는다 - 목업으로 떨어져야 한다', async () => {
    const { findLlmSample } = await load([sample]);
    expect(findLlmSample('전혀 다른 질문')).toBeUndefined();
    // 부분 일치로 우연히 걸리지 않는다(경계가 흐려지면 무엇이 재생인지 말할 수 없다).
    expect(findLlmSample('테스트 코드는')).toBeUndefined();
  });

  it('샘플이 없으면 hasLlmSamples 가 거짓 - 화면은 목업 표기로 남는다', async () => {
    const { hasLlmSamples } = await load([]);
    expect(hasLlmSamples()).toBe(false);
  });

  it('커밋된 파일은 배열이고 각 항목이 계약 형태를 지킨다', async () => {
    vi.resetModules();
    vi.doUnmock('./llm-samples.json');
    const committed = (await import('./llm-samples.json')).default as unknown;
    expect(Array.isArray(committed)).toBe(true);
    for (const item of committed as Record<string, unknown>[]) {
      expect(typeof item.question).toBe('string');
      expect(typeof item.reply).toBe('string');
      expect(typeof item.model).toBe('string');
      expect(typeof item.generatedAt).toBe('string');
    }
  });
});

/**
 * 산출물을 만드는 쪽(scripts/make-llm-samples.mjs)과 쓰는 쪽이 어긋나면 조용히 실패한다 -
 * 질문 한 글자가 다르면 영영 재생되지 않고, 프롬프트가 다르면 재생본이 로컬 키 실행과 성격이
 * 달라진다. 둘 다 화면에 오류로 나타나지 않으므로 테스트가 대신 본다.
 */
describe('생성 스크립트와의 정합', () => {
  // vitest 의 import.meta.url 은 file: 스킴이 아니라 URL 로는 읽을 수 없다. 러너의 작업
  // 디렉토리(앱 루트)를 기준으로 삼는다.
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
  const scriptSource = read('scripts/make-llm-samples.mjs');

  it('시스템 프롬프트가 런타임 어댑터와 같다', () => {
    // 노드 스크립트라 TS 를 import 할 수 없어 문자열이 두 벌이다. 같은 값인지만 확인한다.
    const start = scriptSource.indexOf('const SYSTEM_PROMPT = [');
    const block = scriptSource.slice(start, scriptSource.indexOf('].join(', start));
    // 홑따옴표·겹따옴표가 섞여 있다(첫 줄이 'JC Chat' 을 품고 있어 겹따옴표다).
    const parts = [...block.matchAll(/'([^']*)'|"([^"]*)"/g)].map((m) => m[1] ?? m[2]);
    expect(parts.join(' ')).toBe(SYSTEM_PROMPT);
  });

  it('생성 대상 질문이 화면의 추천 칩과 문자열까지 같다', () => {
    const chips = read('src/components/home/ChatHome.tsx');
    for (const q of scriptSource.matchAll(/^ {2}'(.+\?)',$/gm)) {
      expect(chips).toContain(`'${q[1]}'`);
    }
  });

  it('커밋된 응답은 평문이다 - 말풍선에 마크다운 파서가 없다', async () => {
    vi.resetModules();
    vi.doUnmock('./llm-samples.json');
    const committed = (await import('./llm-samples.json')).default as { reply: string }[];
    for (const { reply } of committed) {
      expect(reply).not.toMatch(/\*\*|`|^#{1,6} |^[-*] |^\d+\. /m);
    }
  });
});

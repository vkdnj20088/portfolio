import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown } from './miniMarkdown';

/**
 * 파서의 안전 경계(#C1)를 못박는다.
 *
 * 이 테스트가 검증하는 핵심은 "위험한 입력을 걸러낸다"가 아니라 <b>위험한 토큰을 만들 수 없다</b>는
 * 것이다. 파서가 낼 수 있는 토큰 종류가 유한하고 그중 HTML 이 되는 것이 없으면, 우회 입력을
 * 상상하는 일 자체가 필요 없어진다.
 */
describe('miniMarkdown - raw HTML 은 파싱 대상이 아니다', () => {
  it('스크립트 태그는 text 토큰으로만 남는다', () => {
    const t = parseInline('<script>alert(1)</script>');
    expect(t).toEqual([{ kind: 'text', text: '<script>alert(1)</script>' }]);
  });

  it('이미지 onerror 도 text 다 - 태그가 될 경로가 없다', () => {
    const t = parseInline('<img src=x onerror=alert(1)>');
    expect(t.every((x) => x.kind === 'text')).toBe(true);
  });

  it('블록 파싱에서도 HTML 은 문단 텍스트다', () => {
    const b = parseMarkdown('<div onclick="x">hi</div>');
    expect(b).toHaveLength(1);
    const first = b[0]!;
    expect(first.kind).toBe('paragraph');
    if (first.kind !== 'paragraph') throw new Error('unreachable');
    expect(first.inline.every((x) => x.kind === 'text')).toBe(true);
  });
});

describe('miniMarkdown - 링크 스킴 화이트리스트', () => {
  it.each([
    ['[x](javascript:alert(1))', 'javascript'],
    ['[x](JaVaScRiPt:alert(1))', '대소문자 우회'],
    ['[x](data:text/html;base64,PHNjcmlwdD4=)', 'data'],
    ['[x](vbscript:msgbox)', 'vbscript'],
  ])('%s 는 링크가 되지 않는다(%s)', (src) => {
    const t = parseInline(src);
    expect(t.some((x) => x.kind === 'link')).toBe(false);
    // 조용히 삼키지 않고 원문을 보여 준다 - 링크가 있었다는 사실이 사라지면 안 된다.
    expect(t.map((x) => x.text).join('')).toContain('x');
  });

  it.each([
    ['[a](https://example.com)', 'https'],
    ['[a](http://example.com)', 'http'],
    ['[a](mailto:a@b.c)', 'mailto'],
    ['[a](/search)', '상대 경로'],
    ['[a](#top)', '앵커'],
  ])('%s 는 링크가 된다(%s)', (src) => {
    const t = parseInline(src);
    expect(t.some((x) => x.kind === 'link')).toBe(true);
  });

  it('링크 문구가 비면 주소를 문구로 쓴다', () => {
    const t = parseInline('[](https://example.com)');
    expect(t[0]).toEqual({
      kind: 'link',
      text: 'https://example.com',
      href: 'https://example.com',
    });
  });
});

describe('miniMarkdown - 문법 우선순위와 원문 보존', () => {
  it('코드가 강조보다 먼저다 - 코드 안의 별표는 강조가 아니다', () => {
    const t = parseInline('`**a**`');
    expect(t).toEqual([{ kind: 'code', text: '**a**' }]);
  });

  it('강조/기울임/인라인코드를 섞어도 텍스트가 유실되지 않는다', () => {
    const src = 'a **b** c *d* e `f` g';
    const t = parseInline(src);
    // 토큰 텍스트를 마크업 없이 이으면 원문에서 기호만 빠진 형태가 된다(글자 유실 0).
    expect(t.map((x) => x.text).join('')).toBe('a b c d e f g');
  });

  it('닫히지 않은 펜스는 끝까지 코드다 - 스트리밍 중 깜빡임을 막는다', () => {
    const b = parseMarkdown('설명\n```ts\nconst a = 1;\nconst b = 2;');
    expect(b[1]).toEqual({ kind: 'codeBlock', lang: 'ts', text: 'const a = 1;\nconst b = 2;' });
  });

  it('목록과 코드 블록과 문단이 순서대로 분리된다', () => {
    const b = parseMarkdown('앞\n- 하나\n- 둘\n\n```\ncode\n```\n뒤');
    expect(b.map((x) => x.kind)).toEqual(['paragraph', 'list', 'codeBlock', 'paragraph']);
  });

  it('빈 문자열도 던지지 않는다', () => {
    expect(parseMarkdown('')).toEqual([]);
    expect(parseInline('')).toEqual([{ kind: 'text', text: '' }]);
  });
});

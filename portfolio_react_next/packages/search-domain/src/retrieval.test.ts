import { describe, it, expect } from 'vitest';
import { search, tokenize, tokenizeQuery } from './retrieval';
import { ALL_PASSAGES } from './corpus';

describe('tokenize', () => {
  it('한글 조사를 떼어 매칭 단위를 정규화한다', () => {
    expect(tokenize('연차를 신청')).toEqual(['연차', '신청']);
    expect(tokenize('비밀번호는 변경')).toEqual(['비밀번호', '변경']);
  });
  it('스템이 1자로 줄면 조사로 보지 않는다("휴가"는 유지)', () => {
    expect(tokenize('휴가')).toEqual(['휴가']);
  });
  it('빈/공백 입력은 빈 배열', () => {
    expect(tokenize('   ')).toEqual([]);
  });
});

describe('tokenizeQuery (사전 가드)', () => {
  it('색인된 모든 토큰은 그대로 질의해도 자기 자신으로 정규화된다(과절단 방지)', () => {
    // 규칙 기반 어미 절단은 맨 명사를 자를 수 있다(와이파이->와이파, 지정가->지정).
    // 색인 어휘를 사전으로 써서 그 비대칭을 막는다 - 이 불변식이 깨지면 그 단어는 검색이 안 된다.
    const indexed = new Set(ALL_PASSAGES.flatMap((p) => tokenize(p.text)));
    const broken = [...indexed].filter((t) => tokenizeQuery(t)[0] !== t);
    expect(broken).toEqual([]);
  });

  it('맨 명사로 물어도 활용형이 색인된 문단을 찾는다', () => {
    expect(search('와이파이', 'semantic').length).toBeGreaterThan(0);
    expect(search('지정가', 'semantic').length).toBeGreaterThan(0);
  });
});

describe('search 결정성', () => {
  it('같은 질의는 늘 같은 순서를 반환(난수 없음)', () => {
    const a = search('연차 며칠', 'semantic');
    const b = search('연차 며칠', 'semantic');
    expect(a.map((s) => s.passage.id)).toEqual(b.map((s) => s.passage.id));
  });
});

describe('키워드 vs 시맨틱 차이', () => {
  it('시맨틱은 동의어로 확장해 "휴가"로 물어도 연차/반차 문단을 잡지만, 키워드는 놓친다', () => {
    // "휴가" 라는 단어를 직접 안 담은 문단(반차 규정 등)을 시맨틱은 잡아야 한다.
    const semantic = search('휴가 규정', 'semantic');
    const semanticTop = semantic.map((s) => s.passage.id);
    expect(semanticTop.some((id) => id.startsWith('HR-01'))).toBe(true);

    // 반차만 언급한 문단(HR-01-p2)은 "휴가" 키워드로는 semantic>keyword 여야 한다(동의어 확장 효과).
    const p2 = semantic.find((s) => s.passage.id === 'HR-01-p2');
    expect(p2).toBeTruthy();
    expect(p2!.semantic).toBeGreaterThan(p2!.keyword);
  });

  it('정확 일치어는 키워드/시맨틱 모두 잡는다', () => {
    const r = search('비밀번호 변경', 'keyword');
    expect(r.length).toBeGreaterThan(0);
    expect(r.some((s) => s.passage.docId === 'SEC-01')).toBe(true);
  });
});

describe('무관 질의', () => {
  it('코퍼스와 겹치지 않는 질의는 빈 결과', () => {
    expect(search('zzzz9999 xkcd', 'semantic')).toEqual([]);
  });
});

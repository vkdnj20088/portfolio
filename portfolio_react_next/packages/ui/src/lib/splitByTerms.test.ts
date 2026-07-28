import { describe, it, expect } from 'vitest';
import { splitByTerms } from './splitByTerms';

const marked = (text: string, terms: string[]) =>
  splitByTerms(text, terms)
    .filter((s) => s.match)
    .map((s) => s.text);

describe('splitByTerms', () => {
  it('매칭 부분만 표시하고 원문은 손실 없이 보존한다', () => {
    const segments = splitByTerms('연차 유급휴가 연차 신청', ['연차']);
    expect(segments.map((s) => s.text).join('')).toBe('연차 유급휴가 연차 신청');
    expect(marked('연차 유급휴가 연차 신청', ['연차'])).toEqual(['연차', '연차']);
  });

  it('매칭이 맨 앞에 있어도 판정이 밀리지 않는다', () => {
    // split 결과의 첫 조각이 빈 문자열이라, 빈 조각을 먼저 걸러내면 홀짝이 뒤집힌다.
    expect(marked('연차를 신청', ['연차'])).toEqual(['연차']);
  });

  it('매칭이 연속으로 붙어도 판정이 밀리지 않는다', () => {
    expect(marked('연차연차 신청', ['연차'])).toEqual(['연차', '연차']);
  });

  it('정규식 메타문자가 든 어휘도 문자 그대로 매칭한다', () => {
    expect(marked('총액(원) 확인', ['(원)'])).toEqual(['(원)']);
    expect(marked('a.b 와 axb', ['a.b'])).toEqual(['a.b']); // '.' 이 임의문자로 새지 않는다
  });

  it('긴 어휘를 먼저 매칭한다', () => {
    expect(marked('유급휴가 규정', ['휴가', '유급휴가'])).toEqual(['유급휴가']);
  });

  it('대소문자를 무시한다', () => {
    expect(marked('Retrospective 인터페이스', ['retrospective'])).toEqual(['Retrospective']);
  });

  it('어휘가 없으면 원문 한 조각', () => {
    expect(splitByTerms('그대로', [])).toEqual([{ text: '그대로', match: false }]);
  });
});

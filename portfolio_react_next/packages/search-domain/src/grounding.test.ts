import { describe, it, expect } from 'vitest';
import { extractAnswer } from './mrc';
import { verifyGrounding } from './grounding';

/**
 * "환각 없음"을 문서가 아니라 실행으로 못박는 테스트. 답변이 인용 문단의 실제 구간과 축자 일치해야만
 * verbatim=true 다. 훗날 누군가 생성형으로 갈아끼워 한 글자라도 덧붙이면 이 테스트가 먼저 깨진다.
 */
describe('verifyGrounding', () => {
  it('추출형 답변은 축자 일치 + 인용 있음으로 검증된다', () => {
    const ans = extractAnswer('연차는 며칠 부여되나요?');
    expect(ans).not.toBeNull();
    const report = verifyGrounding(ans);
    expect(report.verbatim).toBe(true);
    expect(report.cited).toBe(true);
    expect(report.spanRatio).toBeGreaterThan(0);
    expect(report.spanRatio).toBeLessThanOrEqual(1);
  });

  it('한 글자라도 지어내면 축자 검증이 깨진다(생성형 회귀 감지)', () => {
    const ans = extractAnswer('연차는 며칠 부여되나요?')!;
    const tampered = { ...ans, text: ans.text + ' (아마도요)' };
    expect(verifyGrounding(tampered).verbatim).toBe(false);
  });

  it('범위를 벗어난 span 도 검증 실패로 잡는다', () => {
    const ans = extractAnswer('연차는 며칠 부여되나요?')!;
    expect(verifyGrounding({ ...ans, spanEnd: ans.passageText.length + 10 }).verbatim).toBe(false);
  });

  it('정답 없음(null)은 근거 0', () => {
    expect(verifyGrounding(null)).toEqual({ verbatim: false, cited: false, spanRatio: 0 });
  });
});

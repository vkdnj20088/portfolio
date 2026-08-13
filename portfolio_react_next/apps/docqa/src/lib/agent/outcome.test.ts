import { describe, expect, it } from 'vitest';
import { classifyOutcome } from './outcome';

describe('종료 상태 판정', () => {
  it('첫 줄이 센티널이면 근거 없음이다', () => {
    const r = classifyOutcome('NO_GROUNDS\n주차장 관련 문단이 코퍼스에 없습니다.');
    expect(r.refused).toBe(true);
    expect(r.summary).toBe('주차장 관련 문단이 코퍼스에 없습니다.');
  });

  it('센티널 줄은 화면에 나가는 요약에서 빠진다', () => {
    expect(classifyOutcome('NO_GROUNDS\n이유').summary).not.toContain('NO_GROUNDS');
  });

  it('이유가 비어 있으면 기본 문장을 넣는다 - 화면이 빈 답을 띄우면 안 된다', () => {
    expect(classifyOutcome('NO_GROUNDS').summary).toBe('사내문서에서 근거를 찾지 못했습니다.');
  });

  it('답한 뒤 덧붙인 단서를 거절로 읽지 않는다', () => {
    // 첫 수집에서 실제로 뒤집혔던 모양이다. 판정과 절차를 근거까지 달아 답한 실행이
    // 끝에 "이 부분은 찾지 못했습니다" 한 줄을 붙였다는 이유로 근거 없음이 됐다.
    const answered =
      '## 접근 판정 결과\n거부(DENY)입니다. (근거: SEC-02-p2)\n' +
      '다만 예외 신청 양식 자체는 코퍼스에서 찾지 못했습니다.';
    expect(classifyOutcome(answered).refused).toBe(false);
  });

  it('본문 안의 센티널 언급에 걸리지 않는다', () => {
    expect(classifyOutcome('규정상 NO_GROUNDS 로 답해야 합니다.').refused).toBe(false);
  });

  it('앞뒤 공백에는 흔들리지 않는다', () => {
    expect(classifyOutcome('  NO_GROUNDS  \n  이유  ').refused).toBe(true);
  });
});

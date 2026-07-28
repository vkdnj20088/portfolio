import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SpanHighlight, TermHighlight } from './highlight';

describe('SpanHighlight (근거 span)', () => {
  it('[start, end) 구간만 mark 로 감싸고 나머지 텍스트는 보존한다', () => {
    const { container } = render(
      <p>
        <SpanHighlight text="가나다라마" start={1} end={3} />
      </p>,
    );
    const mark = container.querySelector('mark');
    expect(mark?.textContent).toBe('나다');
    expect(container.textContent).toBe('가나다라마'); // 원문 손실 없음
  });

  it('잘못된 범위는 원문 그대로(하이라이트 없음)', () => {
    const { container } = render(
      <p>
        <SpanHighlight text="abc" start={-1} end={2} />
      </p>,
    );
    expect(container.querySelector('mark')).toBeNull();
    expect(container.textContent).toBe('abc');
  });
});

describe('TermHighlight (검색 매칭어)', () => {
  it('매칭 term 출현부만 mark 로 감싼다', () => {
    const { container } = render(
      <p>
        <TermHighlight text="연차 유급휴가 연차 신청" terms={['연차']} />
      </p>,
    );
    const marks = [...container.querySelectorAll('mark')].map((m) => m.textContent);
    expect(marks).toEqual(['연차', '연차']);
    expect(container.textContent).toBe('연차 유급휴가 연차 신청');
  });

  it('term 이 없으면 원문 그대로', () => {
    const { container } = render(
      <p>
        <TermHighlight text="hello" terms={[]} />
      </p>,
    );
    expect(container.querySelector('mark')).toBeNull();
    expect(container.textContent).toBe('hello');
  });
});

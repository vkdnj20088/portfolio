import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MessageComposer } from './MessageComposer';

/**
 * MessageComposer 의 두 가지 "잘 틀리는" 상호작용을 jsdom 에서 고정한다.
 *
 *  1) 한국어 IME 조합 중 Enter 로 마지막 글자가 중복 전송되지 않을 것(isComposing/keyCode 229 가드).
 *  2) 전송 잠금이 풀릴 때 포커스를 입력창으로 복원하되, 사용자가 스스로 옮긴 포커스는 뺏지 않을 것.
 *
 * 둘 다 DOM 이벤트와 activeElement 만 있으면 검증되므로 실제 브라우저가 필요 없다
 * (레이아웃/matchMedia 에 의존하는 스크롤 규칙은 e2e/ 로 분리했다).
 */

function renderComposer(props: Partial<Parameters<typeof MessageComposer>[0]> = {}) {
  const onSubmit = vi.fn();
  const onChange = vi.fn();
  const view = render(
    <MessageComposer value="안녕하세요" onChange={onChange} onSubmit={onSubmit} {...props} />,
  );
  const textarea = screen.getByLabelText('메시지 입력') as HTMLTextAreaElement;
  return { onSubmit, onChange, textarea, ...view };
}

describe('IME 조합 중복 전송 가드', () => {
  it('조합 중(isComposing) Enter 는 전송하지 않는다', () => {
    const { onSubmit, textarea } = renderComposer();
    fireEvent.keyDown(textarea, { key: 'Enter', isComposing: true });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('구형 IME 의 keyCode 229 Enter 도 전송하지 않는다', () => {
    const { onSubmit, textarea } = renderComposer();
    fireEvent.keyDown(textarea, { key: 'Enter', keyCode: 229 });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('조합이 끝난 Enter 는 trim 된 내용으로 정확히 한 번 전송한다', () => {
    const { onSubmit, textarea } = renderComposer({ value: '  안녕  ' });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('안녕');
  });

  it('Shift+Enter 는 전송이 아니라 줄바꿈이다', () => {
    const { onSubmit, textarea } = renderComposer();
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('공백뿐인 입력은 Enter 로도 전송되지 않는다', () => {
    const { onSubmit, textarea } = renderComposer({ value: '   ' });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('전송 잠금(disabled) 중에는 Enter 로 전송되지 않는다', () => {
    const { onSubmit, textarea } = renderComposer({ disabled: true });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('전송 잠금 해제 시 포커스 복원', () => {
  it('잠금이 풀리면 body 로 떨어진 포커스를 입력창으로 되돌린다', () => {
    const { rerender } = render(
      <MessageComposer value="" onChange={() => {}} onSubmit={() => {}} disabled={false} />,
    );
    const textarea = screen.getByLabelText('메시지 입력') as HTMLTextAreaElement;
    textarea.focus();
    expect(document.activeElement).toBe(textarea);

    // 전송 사이클 진입 시 브라우저는 잠긴 입력에서 포커스를 body 로 떨군다. jsdom 은
    // disabled 만으로 자동 blur 하지 않고(잠긴 요소엔 blur 도 no-op) 이므로, 그 결과
    // 상태(포커스가 body 에 있음)를 활성 상태에서 blur 해 재현한 뒤 잠근다.
    textarea.blur();
    expect(document.activeElement).toBe(document.body);
    rerender(<MessageComposer value="" onChange={() => {}} onSubmit={() => {}} disabled />);

    // 잠금 해제: 포커스가 body 에 있었으므로(=잠금으로 잃은 경우) 입력창으로 복원한다.
    rerender(<MessageComposer value="" onChange={() => {}} onSubmit={() => {}} disabled={false} />);
    expect(document.activeElement).toBe(textarea);
  });

  it('대기 중 사용자가 다른 곳으로 포커스를 옮겼다면 뺏지 않는다', () => {
    function Harness({ disabled }: { disabled: boolean }) {
      return (
        <>
          <MessageComposer value="" onChange={() => {}} onSubmit={() => {}} disabled={disabled} />
          <button type="button">사이드바</button>
        </>
      );
    }
    const { rerender } = render(<Harness disabled={false} />);
    const textarea = screen.getByLabelText('메시지 입력') as HTMLTextAreaElement;
    textarea.focus();

    rerender(<Harness disabled />);
    const outside = screen.getByText('사이드바') as HTMLButtonElement;
    outside.focus(); // 사용자가 대기 중 스스로 이동
    expect(document.activeElement).toBe(outside);

    // 포커스가 body 가 아니라 다른 요소에 있으므로 복원 로직은 개입하지 않는다.
    rerender(<Harness disabled={false} />);
    expect(document.activeElement).toBe(outside);
  });
});

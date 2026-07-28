import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Dialog } from './Dialog';

/**
 * Dialog 의 접근성 계약을 고정한다: 렌더 게이팅, 초기 포커스(확인), Esc/확인 동작,
 * 닫힘 시 포커스 복원, Tab 포커스 트랩. 오버레이 a11y 의 핵심이라 회귀를 테스트로 막는다.
 */
function Harness({
  onConfirm = () => {},
  onCancel = () => {},
}: {
  onConfirm?: () => void;
  onCancel?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        열기
      </button>
      <Dialog
        open={open}
        title="채팅방 삭제"
        destructive
        confirmLabel="삭제"
        cancelLabel="취소"
        onConfirm={() => {
          onConfirm();
          setOpen(false);
        }}
        onCancel={() => {
          onCancel();
          setOpen(false);
        }}
      >
        정말 삭제할까요?
      </Dialog>
    </>
  );
}

describe('Dialog', () => {
  it('닫혀 있으면 렌더되지 않는다', () => {
    render(<Harness />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('열면 aria-modal 대화상자가 뜨고 확인 버튼에 포커스한다', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('열기'));

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '삭제' }));
  });

  it('Esc 로 닫힌다(onCancel)', () => {
    const onCancel = vi.fn();
    render(<Harness onCancel={onCancel} />);
    fireEvent.click(screen.getByText('열기'));

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('확인 클릭 시 onConfirm 을 부른다', () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    fireEvent.click(screen.getByText('열기'));

    fireEvent.click(screen.getByRole('button', { name: '삭제' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('닫히면 열기 전 포커스로 복원한다', () => {
    render(<Harness />);
    const openButton = screen.getByText('열기');
    openButton.focus();
    fireEvent.click(openButton); // 열림 - 확인 버튼으로 포커스 이동

    fireEvent.keyDown(document, { key: 'Escape' }); // 닫힘
    expect(document.activeElement).toBe(openButton); // 원래 자리로 복원
  });

  it('Tab 포커스 트랩 - 마지막에서 Tab 은 첫 요소로 순환한다', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('열기'));

    // 초기 포커스는 확인(삭제) = 액션 영역의 마지막 포커서블. Tab 이면 첫 요소(취소)로 감싼다.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '삭제' }));
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '취소' }));

    // 첫 요소(취소)에서 Shift+Tab 이면 마지막(삭제)으로 감싼다.
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '삭제' }));
  });
});

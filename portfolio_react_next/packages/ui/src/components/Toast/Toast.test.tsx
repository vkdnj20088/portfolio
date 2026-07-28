import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ToastProvider, useToast } from './Toast';

function Trigger() {
  const { showToast } = useToast();
  return (
    <button type="button" onClick={() => showToast('저장에 실패했습니다.', { variant: 'error', durationMs: 0 })}>
      알림 띄우기
    </button>
  );
}

describe('Toast', () => {
  it('provider 밖에서 useToast 는 오류를 던진다', () => {
    // React 가 렌더 오류를 콘솔로 흘리지만, 계약(가드) 자체를 고정한다.
    expect(() => render(<Trigger />)).toThrow(/ToastProvider/);
  });

  it('polite 라이브 리전에 토스트를 쌓고, 닫기로 제거한다', () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );

    const region = screen.getByRole('region', { name: '알림' });
    expect(region.getAttribute('aria-live')).toBe('polite'); // 흐름을 막지 않는 예의 바른 알림

    fireEvent.click(screen.getByText('알림 띄우기'));
    expect(screen.getByText('저장에 실패했습니다.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '알림 닫기' }));
    expect(screen.queryByText('저장에 실패했습니다.')).toBeNull();
  });
});

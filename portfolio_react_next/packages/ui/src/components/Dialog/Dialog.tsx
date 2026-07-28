'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../Button/Button';
import styles from './Dialog.module.css';

export interface DialogProps {
  open: boolean;
  title: string;
  /** 본문(설명). 있으면 aria-describedby 로 연결된다. */
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 파괴적 액션(삭제 등)이면 확인 버튼을 danger 로 그린다. */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * 모달 확인 대화상자 - window.confirm 을 대체한다.
 *
 * 접근성 계약: role="dialog" + aria-modal, 열리면 확인 버튼에 포커스, 열려 있는 동안 Tab 은
 * 대화상자 안에서만 순환한다(포커스 트랩). Esc / 취소 / 바깥 클릭으로 닫히고, 닫히면 열기 전
 * 포커스를 되돌린다 - 이 마지막 복원이 키보드 사용자를 원래 조작하던 버튼 자리로 데려온다.
 */
export function Dialog({
  open,
  title,
  children,
  confirmLabel = '확인',
  cancelLabel = '취소',
  destructive = false,
  onConfirm,
  onCancel,
}: DialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const bodyId = `${baseId}-body`;

  // 열림: 열기 전 포커스를 기억하고 확인 버튼으로 이동. 정리(닫힘): 기억한 곳으로 복원.
  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    confirmRef.current?.focus();
    return () => {
      restoreFocusRef.current?.focus?.();
    };
  }, [open]);

  // Esc 닫기 + Tab 포커스 트랩. 문서 레벨 리스너는 열려 있는 동안만 산다.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [href], input:not(:disabled), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return createPortal(
    <div
      className={styles.backdrop}
      onMouseDown={(event) => {
        // 백드롭(바깥) 클릭만 닫는다 - 대화상자 내부 클릭은 통과시킨다.
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={children ? bodyId : undefined}
      >
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        {children && (
          <div id={bodyId} className={styles.body}>
            {children}
          </div>
        )}
        <div className={styles.actions}>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            ref={confirmRef}
            variant={destructive ? 'danger' : 'primary'}
            size="sm"
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { cn } from '../../lib/cn';
import styles from './Toast.module.css';

export type ToastVariant = 'info' | 'error';

export interface ShowToastOptions {
  variant?: ToastVariant;
  /** 자동 소멸 ms. 0 이면 수동으로 닫을 때까지 유지한다. 기본 5000. */
  durationMs?: number;
}

interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  showToast: (message: string, options?: ShowToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/**
 * 앱 전역 토스트 - window.alert 을 대체한다.
 *
 * polite 라이브 리전 하나에 토스트를 쌓는다. alert 의 모달 블로킹과 달리 사용자 흐름을
 * 가로막지 않으면서, 끝에 추가되는 알림을 보조기술이 예의 바르게 읽어 준다. 리전은 토스트가
 * 없을 때도 DOM 에 상주해야 "추가" 가 알림으로 잡히므로 항상 렌더한다(빈 컨테이너로).
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, options: ShowToastOptions = {}) => {
      const id = nextId.current++;
      setToasts((current) => [...current, { id, message, variant: options.variant ?? 'info' }]);
      const duration = options.durationMs ?? 5000;
      if (duration > 0) {
        setTimeout(() => dismiss(id), duration);
      }
    },
    [dismiss],
  );

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className={styles.viewport} role="region" aria-label="알림" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={cn(styles.toast, styles[toast.variant])}>
            <span className={styles.message}>{toast.message}</span>
            <button
              type="button"
              className={styles.dismiss}
              aria-label="알림 닫기"
              onClick={() => dismiss(toast.id)}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast 는 <ToastProvider> 안에서만 사용할 수 있습니다.');
  }
  return context;
}

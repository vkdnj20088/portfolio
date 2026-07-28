import { cn } from '../../lib/cn';
import styles from './Spinner.module.css';

export interface SpinnerProps {
  /** 픽셀 크기. 기본 16px. */
  size?: number;
  className?: string;
  /** 스크린리더에 읽힐 상태 문구. 장식용으로 쓸 땐 null 을 넘겨 숨긴다. */
  label?: string | null;
}

export function Spinner({ size = 16, className, label = '불러오는 중' }: SpinnerProps) {
  return (
    <span
      className={cn(styles.spinner, className)}
      style={{ width: size, height: size }}
      role={label ? 'status' : undefined}
      aria-label={label ?? undefined}
      aria-hidden={label ? undefined : true}
    />
  );
}

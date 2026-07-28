import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'ghost' | 'danger';
export type ButtonSize = 'xs' | 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** 아이콘만 있는 정사각형 버튼. 이 경우 접근 가능한 이름을 위해 aria-label 이 필요하다. */
  iconOnly?: boolean;
}

/**
 * 기본 버튼.
 *
 * `type` 기본값을 명시적으로 "button" 으로 둔다. HTML 기본값은 "submit" 이라,
 * 폼 안에 놓인 버튼이 의도치 않게 폼을 제출하는 사고가 흔하다.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', iconOnly = false, className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        styles.button,
        styles[variant],
        styles[size],
        iconOnly && styles.iconOnly,
        className,
      )}
      {...rest}
    />
  );
});

'use client';

import { useEffect, useLayoutEffect, useRef, type FormEvent, type KeyboardEvent } from 'react';
import { Button } from '@chat/ui';
import styles from './MessageComposer.module.css';

interface MessageComposerProps {
  value: string;
  onChange: (next: string) => void;
  /** trim 된 내용으로 호출된다. 빈 값이면 호출되지 않는다. */
  onSubmit: (content: string) => void;
  /** 전송 진행 중 등 - 입력은 유지하고 전송만 막는다. */
  disabled?: boolean;
  autoFocus?: boolean;
}

const MAX_HEIGHT_PX = 160;

/**
 * 메시지 입력 폼 - 채팅홈과 채팅방이 같은 컴포넌트를 재사용한다(명세 요구).
 * 상태(value)를 밖에서 소유하는 controlled 컴포넌트로 만든 이유이기도 하다:
 * 홈은 드래프트를 sessionStorage 에 영속하고, 채팅방은 전송 후 비우는 식으로
 * 소유자마다 수명 정책이 다르다.
 */
export function MessageComposer({
  value,
  onChange,
  onSubmit,
  disabled = false,
  autoFocus = false,
}: MessageComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const trimmed = value.trim();
  const canSend = !disabled && trimmed !== '';

  // 입력 줄 수에 맞춰 높이를 늘린다(상한까지). 페인트 전에 맞춰야 깜빡임이 없다.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [value]);

  /*
   * 전송~응답 사이클 동안 disabled 가 되면 브라우저는 포커스를 body 로 떨어뜨리고,
   * 잠금이 풀려도 되돌려 주지 않는다 - 키보드 사용자는 매 전송마다 Tab 으로
   * 입력창까지 되돌아와야 한다. 잠금 해제 시 입력창으로 복원하되, 대기 중
   * 사용자가 스스로 다른 곳(사이드바 등)에 포커스를 옮겼다면 빼앗지 않는다
   * (포커스가 body 에 떨어져 있을 때 = disabled 로 잃은 경우에만 복원).
   */
  const prevDisabledRef = useRef(disabled);
  useEffect(() => {
    const wasDisabled = prevDisabledRef.current;
    prevDisabledRef.current = disabled;
    if (!wasDisabled || disabled) return;
    if (document.activeElement === document.body || document.activeElement === null) {
      textareaRef.current?.focus();
    }
  }, [disabled]);

  function submit() {
    if (canSend) onSubmit(trimmed);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    submit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey) return;
    // 한국어 IME 조합 중 Enter 는 keydown 이 한 번 더 발생한다. 이 가드가 없으면
    // 마지막 글자가 중복 전송된다(keyCode 229 는 구형 크롬용 보조 가드).
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    submit();
  }

  return (
    <form className={styles.composer} onSubmit={handleSubmit}>
      <textarea
        ref={textareaRef}
        className={styles.textarea}
        rows={1}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="메시지 입력"
        aria-label="메시지 입력"
        disabled={disabled}
        autoFocus={autoFocus}
      />
      {/* 좁은 화면에서는 라벨이 원형 ↑ 아이콘으로 교대한다(STEP 14, CSS 가 전담).
          aria-label 이 고정이라 접근 가능한 이름은 어느 형태든 "전송"이다. */}
      <Button type="submit" size="md" disabled={!canSend} aria-label="전송" className={styles.send}>
        <span className={styles.sendLabel}>전송</span>
        <span className={styles.sendIcon} aria-hidden="true">
          ↑
        </span>
      </Button>
    </form>
  );
}

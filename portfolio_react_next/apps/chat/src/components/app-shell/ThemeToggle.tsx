'use client';

import { useEffect, useState } from 'react';
import styles from './ThemeToggle.module.css';

type ThemePref = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'ai-chat/theme';

function resolve(pref: ThemePref): 'light' | 'dark' {
  if (pref === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return pref;
}

/** 해석된 테마를 data-theme 으로 실체화한다 - 다크 토큰 블록(tokens.css)의 유일한 스위치. */
function apply(pref: ThemePref) {
  document.documentElement.dataset.theme = resolve(pref);
}

const OPTIONS: Array<{ value: ThemePref; label: string }> = [
  { value: 'system', label: '시스템' },
  { value: 'light', label: '라이트' },
  { value: 'dark', label: '다크' },
];

/**
 * 테마 선택(STEP 11) - 시스템(기본)/라이트/다크 3상태.
 *
 * 첫 페인트의 테마는 루트 레이아웃의 인라인 스크립트가 이미 맞춰 놨으므로(FOUC 방지)
 * 이 컴포넌트는 "선택 UI 와 이후의 전환" 만 책임진다. SSR 은 항상 '시스템' 으로 그리고
 * 마운트 후 저장값을 반영한다(홈 드래프트와 같은 hydration 불일치 회피 - 어긋나는 것은
 * 버튼의 눌림 표시뿐이고 화면 테마가 아니다).
 */
export function ThemeToggle() {
  const [pref, setPref] = useState<ThemePref>('system');

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') setPref(saved);
  }, []);

  // 시스템 모드일 때만 OS 테마 변화를 따라간다 - 수동 선택은 OS 가 바뀌어도 고정.
  useEffect(() => {
    if (pref !== 'system') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => apply('system');
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [pref]);

  function select(next: ThemePref) {
    setPref(next);
    try {
      // '시스템' 은 저장하지 않는 것으로 표현한다 - 키 부재 = 기본값.
      if (next === 'system') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // 저장 실패해도 이번 세션의 테마 전환은 유효하다(드래프트와 같은 최선노력).
    }
    apply(next);
  }

  return (
    <div className={styles.group} role="group" aria-label="테마 선택">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={styles.option}
          aria-pressed={pref === option.value}
          onClick={() => select(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

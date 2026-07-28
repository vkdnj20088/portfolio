'use client';

import { useEffect, useState } from 'react';
import { Button } from '@chat/ui';

const STORAGE_KEY = 'ai-chat/sidebar';

/**
 * 좁은 화면의 오버레이 모드에서 "방을 선택하면 목록이 접힌다"(드로어 관례)를
 * 위한 신호(STEP 14). 목록(ChatRoomList)이 쏘고 여기가 받는다 - 접힘 상태의
 * 진실원(html 속성)과 토글 버튼의 aria 가 함께 갱신되도록 컴포넌트를 통과시킨다.
 */
export const SIDEBAR_COLLAPSE_EVENT = 'ai-chat:collapse-sidebar';

/**
 * 사이드바 접기/펼치기 - 좁은 화면(모바일 웹뷰)에서 대화 영역을 넓히는 최소화 토글.
 *
 * 상태는 html 의 data-sidebar 속성 하나로 실체화한다(CSS 의 유일한 스위치 -
 * 테마 토글과 같은 문법). 선택은 localStorage 로 영속되고, 저장값이 없으면
 * 화면 폭이 기본값을 정한다(좁으면 접힘) - 판정은 루트 레이아웃의 인라인
 * 스크립트가 첫 페인트 전에 끝내므로 여기서는 반복하지 않는다.
 *
 * SSR 은 항상 '펼침'으로 그리고 마운트 후 실제 속성값을 반영한다(테마 토글과
 * 같은 hydration 불일치 회피). 어긋나는 것은 버튼의 아이콘/aria 뿐이고
 * 사이드바 폭이 아니다 - 폭은 인라인 스크립트가 이미 맞춰 놨다.
 */
export function SidebarToggle() {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(document.documentElement.dataset.sidebar === 'collapsed');
  }, []);

  useEffect(() => {
    const onCollapse = () => {
      setCollapsed(true);
      document.documentElement.dataset.sidebar = 'collapsed';
      // 저장하지 않는다 - 방 선택에 따른 맥락상의 접힘이지 사용자의 선호 표명이
      // 아니다. 다음 로드의 기본값 판정(저장값/화면 폭)은 그대로 유효하다.
    };
    window.addEventListener(SIDEBAR_COLLAPSE_EVENT, onCollapse);
    return () => window.removeEventListener(SIDEBAR_COLLAPSE_EVENT, onCollapse);
  }, []);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    if (next) document.documentElement.dataset.sidebar = 'collapsed';
    else delete document.documentElement.dataset.sidebar;
    try {
      // 양방향 모두 명시 저장한다 - 부재는 "화면 폭에 맡김"이라는 별개 상태다.
      localStorage.setItem(STORAGE_KEY, next ? 'collapsed' : 'expanded');
    } catch {
      // 저장 실패해도 이번 세션의 접힘/펼침은 유효하다(테마와 같은 최선노력).
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      iconOnly
      aria-expanded={!collapsed}
      aria-controls="sidebar"
      aria-label={collapsed ? '사이드바 펼치기' : '사이드바 접기'}
      onClick={toggle}
    >
      {collapsed ? '»' : '«'}
    </Button>
  );
}

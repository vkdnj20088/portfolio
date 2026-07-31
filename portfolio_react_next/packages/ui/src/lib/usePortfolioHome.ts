'use client';

import { useSyncExternalStore } from 'react';
import { portfolioHomeHref } from './portfolioHome';

// 값이 바뀔 일이 없으므로 구독하지 않는다(해지 함수만 돌려준다).
const noop = () => () => {};

/**
 * 복귀 링크의 href. 서버 스냅샷은 fallback, 클라 스냅샷은 현재 호스트에서 조립한 값이다.
 *
 * useEffect + setState 로 하지 않는 이유: 그 방식은 첫 렌더 직후 한 번 더 렌더를 강제하고
 * react-hooks/set-state-in-effect 에도 걸린다. useSyncExternalStore 는 React 가 서버/클라
 * 스냅샷을 직접 가르므로 하이드레이션 불일치 없이 한 번에 올바른 값이 나온다
 * (같은 규칙을 ThemeToggle 의 useHydrated 에서도 쓴다).
 *
 * getSnapshot 이 매번 새 문자열을 만들어도 안전하다 - React 는 Object.is 로 비교하는데
 * 문자열은 값으로 같으면 같다고 판정한다(무한 렌더 루프가 생기지 않는다).
 */
export function usePortfolioHome(fallback: string, from?: string): string {
  return useSyncExternalStore(
    noop,
    () => portfolioHomeHref(fallback, from),
    () => fallback,
  );
}

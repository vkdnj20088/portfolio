'use client';

import { useSyncExternalStore } from 'react';
import { isDegraded, resetNetworkQuality, subscribeNetworkQuality } from '@/lib/network/networkQuality';

export type NetworkStatus = 'online' | 'unstable' | 'offline';

/**
 * 브라우저 온/오프라인 이벤트와 요청 품질 관측을 하나의 상태로 합친다.
 *
 * useEffect + useState 대신 useSyncExternalStore 를 쓰는 이유:
 *  - 외부 저장소(navigator, 관측 스토어)를 구독하는 정석 API 다.
 *  - 서버 스냅샷을 따로 줄 수 있어 **하이드레이션 불일치가 구조적으로 발생하지 않는다.**
 *    서버에는 navigator 가 없으므로 'online' 을 서버 스냅샷으로 고정하고,
 *    클라이언트에서 실제 값으로 즉시 정정된다.
 */
export function useNetworkStatus(): NetworkStatus {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function subscribe(onChange: () => void): () => void {
  // 재연결 순간 오프라인 동안 쌓인 실패 관측을 먼저 비운다. 비우지 않으면 연결이
  // 회복돼도 관측 창(WINDOW_MS)이 마를 때까지 'unstable' 배너가 남는다. 이어서
  // onChange 로 navigator.onLine 전환 자체를 스냅샷에 반영한다(reset 은 관측이
  // 이미 비어 있으면 emit 하지 않으므로 onChange 를 따로 부른다).
  const onOnline = () => {
    resetNetworkQuality();
    onChange();
  };
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onChange);
  const unsubscribeQuality = subscribeNetworkQuality(onChange);

  return () => {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onChange);
    unsubscribeQuality();
  };
}

function getSnapshot(): NetworkStatus {
  if (!navigator.onLine) return 'offline';
  return isDegraded() ? 'unstable' : 'online';
}

/** 서버 렌더 시점에는 네트워크를 알 수 없다. 정상으로 가정하고 클라이언트에서 정정한다. */
function getServerSnapshot(): NetworkStatus {
  return 'online';
}

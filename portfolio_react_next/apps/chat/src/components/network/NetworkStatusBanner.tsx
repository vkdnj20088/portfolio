'use client';

import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import styles from './NetworkStatusBanner.module.css';

const MESSAGE = {
  offline: '네트워크에 연결되어 있지 않습니다. 연결을 확인해 주세요.',
  unstable: '네트워크 상태가 불안정합니다. 메시지 전송이 지연될 수 있습니다.',
} as const;

/**
 * 네트워크가 정상이 아닐 때만 상단에 띠를 띄운다.
 *
 * role="status" + aria-live="polite" 로 스크린리더 사용자에게도 상태 변화를 알린다
 * (alert 가 아닌 status 인 이유: 진행 중인 조작을 가로챌 만큼 급한 정보는 아니다).
 */
export function NetworkStatusBanner() {
  const status = useNetworkStatus();

  return (
    <div role="status" aria-live="polite" className={styles.liveRegion}>
      {status !== 'online' && (
        <div className={status === 'offline' ? styles.offline : styles.unstable}>
          <span aria-hidden="true" className={styles.dot} />
          {MESSAGE[status]}
        </div>
      )}
    </div>
  );
}

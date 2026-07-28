'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@chat/ui';
import styles from './error.module.css';

/**
 * 라우트 렌더 중 잡히지 않은 예외의 마지막 방어선(Next App Router error boundary).
 *
 * 이 파일이 없으면 프로덕션에서 사용자에게 빈 화면만 남는다. 여기서는 안내와
 * 복구 경로 두 가지(재시도/홈 이동)를 준다. reset() 은 에러가 난 세그먼트를
 * 다시 렌더한다 - 일시적 상태(경합, 손상된 스토리지 파싱 등)로 인한 예외라면
 * 재시도만으로 회복된다. 레이아웃(사이드바)은 바운더리 밖이라 그대로 살아 있어
 * 다른 채팅방으로의 이동 경로도 유지된다.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // 프로토타입 범위의 로깅 - 실서비스라면 수집기(Sentry 등)로 보낸다.
    console.error(error);
  }, [error]);

  return (
    <div className={styles.center} role="alert">
      <p className={styles.title}>문제가 발생했습니다</p>
      <p className={styles.body}>일시적인 오류일 수 있습니다. 다시 시도해 주세요.</p>
      <div className={styles.actions}>
        <Button variant="primary" size="sm" onClick={reset}>
          다시 시도
        </Button>
        <Link href="/" className={styles.homeLink}>
          채팅 홈으로 이동
        </Link>
      </div>
    </div>
  );
}

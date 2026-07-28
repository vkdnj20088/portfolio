import Link from 'next/link';
import { LogoMark } from './LogoMark';
import styles from './Logo.module.css';

/**
 * 좌측 상단 로고. 클릭하면 채팅 홈으로 이동한다(공통 요구사항).
 *
 * next/link 를 쓰므로 클라이언트 사이드 내비게이션이고, 마크업은 <a> 라
 * 새 탭으로 열기, 링크 복사 같은 브라우저 기본 동작이 그대로 살아 있다.
 */
export function Logo() {
  return (
    <Link href="/" className={styles.logo} aria-label="채팅 홈으로 이동">
      <span className={styles.mark} aria-hidden="true">
        <LogoMark size={18} />
      </span>
      <span className={styles.wordmark}>JC Chat</span>
    </Link>
  );
}

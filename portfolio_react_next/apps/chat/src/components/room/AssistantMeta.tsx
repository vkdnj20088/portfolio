import { LogoMark } from '@/components/app-shell/LogoMark';
import styles from './MessageBubble.module.css';

/**
 * AI 화자 표시(마크 + 이름, STEP 10) - 응답 말풍선과 대기 말풍선이 공유해
 * "생성 중 -> 응답" 전환에서 화자 표시가 튀지 않는다.
 *
 * 좌/우라는 시각 구분은 보조기술에 전달되지 않으므로 이름 텍스트가 화자 구분의
 * 비시각 채널을 겸한다. 마크 자체는 장식이라 숨긴다(aria-hidden).
 */
export function AssistantMeta() {
  return (
    <span className={styles.assistantMeta}>
      <span className={styles.avatar} aria-hidden="true">
        <LogoMark size={12} />
      </span>
      <span className={styles.name}>AI</span>
    </span>
  );
}

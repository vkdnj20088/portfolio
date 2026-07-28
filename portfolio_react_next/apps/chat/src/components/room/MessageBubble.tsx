import { memo, useEffect, useRef, useState } from 'react';
import { formatDateTime, messageText, type Message, type MessageRating } from '@chat/chat-domain';
import { Button, cn, useToast } from '@chat/ui';
import { AssistantMeta } from './AssistantMeta';
import { FadeInText } from './FadeInText';
import styles from './MessageBubble.module.css';

/**
 * parts 렌더러의 exhaustiveness 가드.
 * 컴파일 타임: MessagePart 에 선언된 타입을 스위치에서 빠짐없이 처리하지 않으면
 * (케이스 추가/삭제 누락) 인자 타입이 never 가 아니게 되어 컴파일 에러가 난다.
 * 런타임: 저장소에 남은 미지의 미래 타입은 throw 하지 않고 건너뛴다(깨뜨리지 않는 확장).
 */
function skipUnknownPart(_part: never): null {
  return null;
}

/**
 * 메시지 한 건 - 사용자(우측)/AI(좌측) 말풍선과 생성 시간.
 *
 * 명세의 시간 위치를 문자 그대로 따른다: "사용자 메시지 우측, AI 응답 메시지 좌측에
 * 생성된 시간이 표시" - 즉 양쪽 모두 말풍선의 바깥쪽이다. DOM 순서는 [시간, 본문]
 * 하나로 두고 사용자 쪽만 row-reverse 로 뒤집는다(마크업 분기 없이 CSS 로 해결).
 *
 * 본문은 parts 배열을 순회한다. 지금은 'text' 뿐이지만 표/코드블럭/이미지가 유니온에
 * 추가되면 여기 스위치에 케이스가 늘어날 뿐, 목록/스크롤 계층은 바뀌지 않는다.
 *
 * animate(5단계) - 방금 응답으로 도착한 메시지의 텍스트만 순차 페이드 인한다.
 * 판별은 데이터가 아니라 소유자(RoomBody)의 도착 기록이 한다: 저장된 메시지와
 * 방금 온 메시지는 데이터로는 같아야 하기 때문이다(새로고침하면 같은 메시지가
 * "기존 목록" 으로 로드된다).
 *
 * memo(7단계): 메시지는 불변 데이터라 참조가 안정적이고 animate 는 원시값이다 -
 * 타이핑 등 무관한 상위 리렌더에서 수백 개 말풍선이 다시 그려지는 것을 차단한다.
 * 복사 상태는 말풍선 내부 상태라 memo 와 충돌하지 않는다.
 *
 * 복사(STEP 10) - 실서비스 채팅의 1차 보조 동작. parts 를 합친 순수 텍스트
 * (messageText)를 클립보드에 넣는다. 보조 동작이라 hover/포커스에서만 드러낸다
 * (사이드바 수정/삭제와 같은 문법).
 *
 * 아바타+이름(STEP 10) - AI 응답에는 화자 표시(AssistantMeta)를 단다. 시간 위치
 * 요구("AI 좌측")를 지키기 위해 이름/말풍선을 한 열(assistantBody)로 묶고 시간은
 * 그 왼쪽에 둔다.
 *
 * 피드백/재생성(STEP 11) - 평가는 데이터(message.rating)가 진실원이라 새로고침에도
 * 남고, 평가된 메시지는 액션을 상시 노출해 저장 상태가 보인다. 재생성 콜백은
 * 소유자가 "목록의 마지막 응답"에만 내려보낸다.
 */
export const MessageBubble = memo(function MessageBubble({
  message,
  animate = false,
  highlight = false,
  onRate,
  onRegenerate,
}: {
  message: Message;
  animate?: boolean;
  /** 검색 결과에서 이동해 온 대상 메시지(STEP 16) - 어디로 왔는지 잠깐 표시한다. */
  highlight?: boolean;
  /** 응답 피드백(STEP 11). assistant 메시지에만 렌더된다. */
  onRate?: (messageId: string, rating: MessageRating | null) => void;
  /** 마지막 응답에만 내려온다(STEP 11) - 있으면 재생성 버튼을 렌더한다. */
  onRegenerate?: (messageId: string) => void;
}) {
  const isUser = message.role === 'user';
  const { showToast } = useToast();
  const [copied, setCopied] = useState(false);
  /** "복사됨" 표시를 되돌리는 타이머 - 언마운트 시 정리한다. */
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  async function copy() {
    try {
      // Chrome 66+ / secure context. localhost 평가 환경은 secure context 다.
      await navigator.clipboard.writeText(messageText(message));
      setCopied(true);
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // 권한 거부 등 - 앱 공통 에러 문법(toast)을 따른다.
      showToast('클립보드에 복사하지 못했습니다.', { variant: 'error' });
    }
  }

  const bubble = (
    <div className={styles.bubble}>
      {message.parts.map((part, index) => {
        switch (part.type) {
          case 'text':
            return (
              <p key={index} className={styles.text}>
                {animate ? <FadeInText text={part.text} /> : part.text}
              </p>
            );
          case 'code':
            return (
              /* parts 확장 실증(STEP 12). 코드는 어절 분절(페이드 인)이 무의미해 통째로 렌더한다. */
              <pre key={index} className={styles.codeBlock}>
                <code>{part.text}</code>
              </pre>
            );
          default:
            // 미지의 미래 타입은 건너뛰되(런타임), 선언된 타입 누락은 컴파일 에러로 잡는다.
            return skipUnknownPart(part);
        }
      })}
    </div>
  );

  return (
    /* data-message-id: 검색 결과에서 이 메시지로 이동할 때 목록이 DOM 에서 찾는 열쇠(STEP 16).
       tabIndex=-1 은 탭 순서에 넣지 않으면서 프로그램적 포커스만 허용한다 - 이동 직후
       그 메시지가 읽히고, 키보드 포커스도 목록 안으로 들어온다. */
    <div
      data-message-id={message.id}
      tabIndex={-1}
      className={cn(
        styles.row,
        isUser ? styles.user : styles.assistant,
        highlight && styles.highlighted,
      )}
    >
      <time className={styles.time} dateTime={new Date(message.createdAt).toISOString()}>
        {formatDateTime(message.createdAt)}
      </time>
      {isUser ? (
        bubble
      ) : (
        <div className={styles.assistantBody}>
          <AssistantMeta />
          {bubble}
        </div>
      )}
      {/* 액션은 말풍선 아래 행(grid area)이다 - 옆에 두면 숨김이어도 자리를 차지해
          말풍선 폭을 압박한다. 평가된 메시지는 상시 노출(actionsPinned). */}
      <span className={cn(styles.actions, message.rating && styles.actionsPinned)}>
        <Button variant="ghost" size="xs" onClick={() => void copy()}>
          {copied ? '복사됨' : '복사'}
        </Button>
        {!isUser && onRate && (
          <>
            <Button
              variant={message.rating === 'up' ? 'primary' : 'ghost'}
              size="xs"
              aria-pressed={message.rating === 'up'}
              onClick={() => onRate(message.id, message.rating === 'up' ? null : 'up')}
            >
              좋아요
            </Button>
            <Button
              variant={message.rating === 'down' ? 'primary' : 'ghost'}
              size="xs"
              aria-pressed={message.rating === 'down'}
              onClick={() => onRate(message.id, message.rating === 'down' ? null : 'down')}
            >
              싫어요
            </Button>
          </>
        )}
        {!isUser && onRegenerate && (
          <Button variant="ghost" size="xs" onClick={() => onRegenerate(message.id)}>
            재생성
          </Button>
        )}
      </span>
    </div>
  );
});

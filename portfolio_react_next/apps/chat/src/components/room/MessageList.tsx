'use client';

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { formatDateTime, type Message, type MessageRating } from '@chat/chat-domain';
import { Button, Spinner } from '@chat/ui';
import { AssistantMeta } from './AssistantMeta';
import { MessageBubble } from './MessageBubble';
import bubbleStyles from './MessageBubble.module.css';
import styles from './MessageList.module.css';

/**
 * 'rateLimited' 를 'error' 와 나눈 이유: 회복 시점이 정해진 실패는 사용자가 할 일이 있고
 * (기다린다) 그렇지 않은 실패는 없다. 같은 말풍선으로 보여 주면 그 차이가 사라진다.
 */
export type ReplyStatus = 'idle' | 'waiting' | 'error' | 'rateLimited';

/** "하단 근처" 판정 임계(px). 스트리밍 자동 추적과 "맨 아래로" 버튼 노출이 공유한다. */
const BOTTOM_THRESHOLD_PX = 240;

interface MessageListProps {
  items: Message[];
  /** 더 오래된 페이지가 남아 있는가(커서 존재). */
  hasOlder: boolean;
  loadingOlder: boolean;
  olderError: boolean;
  onLoadOlder: () => void;
  replyStatus: ReplyStatus;
  /** delta 스트리밍이 흐르기 시작하면 대기 말풍선에 누적 표시된다(현재 mock 은 빈 값). */
  streamText: string;
  onRetryReply: () => void;
  /** 레이트리밋 남은 대기 초(#C2). 0 이면 재시도 가능. replyStatus='rateLimited' 일 때만 쓴다. */
  cooldownSeconds?: number;
  /** 응답 대기 중 중단(STEP 11). 대기 말풍선 옆 중지 버튼이 부른다. */
  onStopReply: () => void;
  /** 응답 피드백(STEP 11). 안정 참조 계약 하에 모든 말풍선이 공유한다. */
  onRate: (messageId: string, rating: MessageRating | null) => void;
  /** 응답 재생성(STEP 11). 목록의 마지막 응답에만 내려보낸다. */
  onRegenerateReply: (messageId: string) => void;
  /** 이번 세션에서 응답으로 도착한 메시지 id - 이 목록만 순차 페이드 인한다(5단계). */
  animateIds?: ReadonlySet<string>;
  /** 검색 결과에서 들어온 이동 대상(STEP 16). 목록에 이미 들어와 있어야 한다. */
  jumpToId?: string | null;
  /** 이동을 처리했음을 알린다 - 소유자가 1회성 요청을 소비 처리한다. */
  onJumpHandled?: () => void;
}

/**
 * 메시지 목록 - 채팅 스크롤의 세 가지 규칙을 이 컴포넌트가 전담한다.
 *
 * 1) 새 메시지(끝에 추가)는 부드럽게 최하단으로 스크롤한다(명세).
 *    단 prefers-reduced-motion 사용자는 즉시 이동한다 - 토큰의 전역 CSS 규칙은
 *    JS 스크롤(scrollTo)에는 미치지 않으므로 matchMedia 로 직접 분기한다.
 *
 * 2) 이전 페이지(앞에 추가)는 화면이 밀리면 안 된다. 브라우저의 scroll anchoring 은
 *    scrollTop=0 에서 무력하므로(앵커가 뷰포트 위에 없음) 수동으로 보정한다:
 *    직전 커밋의 scrollHeight 를 기억해 두고, prepend 커밋 직후(useLayoutEffect,
 *    페인트 전) 늘어난 높이만큼 scrollTop 을 더한다. scrollTop 은 보정 시점의
 *    현재 값을 쓰므로 로딩 중 사용자가 스크롤해도 어긋나지 않는다.
 *
 * 3) 최상단 도달 감지는 passive scroll 리스너다. IntersectionObserver 도 후보였지만,
 *    판정이 scrollTop <= 1 비교 하나(O(1))라 쓰로틀이 필요 없어 리스너의 고전적
 *    단점이 소거되고, 관찰자 생성/해제 생명주기 없이 가장 오래된 프리미티브로
 *    동일 동작을 얻는다. "이전 페이지가 있는데 화면이 안 차서 스크롤이 불가능한"
 *    엣지는 구조적으로 없다 - hasOlder 라는 것은 직전 페이지가 꽉 찬 50개였다는
 *    뜻이고, 50개 말풍선은 뷰포트를 반드시 넘친다.
 *
 * "맨 아래로" 버튼(STEP 11)은 같은 리스너의 판정 하나를 더 쓴다. 자동 스크롤
 * 동작(규칙 1)은 명세 문언 그대로 두고, 위로 올라가 읽는 중일 때의 수동 복귀만
 * 더한 것이다. 버튼은 오버레이(absolute)라 목록 높이 - 즉 앵커링 - 에 영향이 없다.
 *
 * memo(7단계): 컴포저 타이핑은 RoomBody 상태 변경이라 목록까지 리렌더가 내려온다.
 * 목록의 props 는 실제 목록 변화(items 교체, 플래그, 응답 상태)에만 바뀌므로 -
 * 콜백은 소유자가 안정 참조를 넘긴다는 계약 하에 - 키 입력마다 수백 개 말풍선
 * 트리를 건드리는 일을 여기서 끊는다.
 */
export const MessageList = memo(function MessageList({
  items,
  hasOlder,
  loadingOlder,
  olderError,
  onLoadOlder,
  replyStatus,
  streamText,
  onRetryReply,
  cooldownSeconds = 0,
  onStopReply,
  onRate,
  onRegenerateReply,
  animateIds,
  jumpToId,
  onJumpHandled,
}: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  /** "맨 아래로" 버튼 노출 여부(STEP 11) - 바닥에서 충분히 멀어졌을 때만 true. */
  const [showJump, setShowJump] = useState(false);
  /** 이동해 온 메시지를 잠깐 강조한다(STEP 16) - 어디로 왔는지 보이게. */
  const [highlightId, setHighlightId] = useState<string | null>(null);

  /* 직전 커밋의 목록 경계와 높이 - append/prepend/초기 로드를 구분하는 근거. */
  const prevFirstIdRef = useRef<string | null>(null);
  const prevLastIdRef = useRef<string | null>(null);
  const prevHeightRef = useRef(0);

  /* 스크롤 핸들러가 읽는 최신 상태 - 리스너는 한 번만 붙이고 값은 ref 로 따라간다. */
  const flagsRef = useRef({ hasOlder, loadingOlder, olderError, onLoadOlder });
  flagsRef.current = { hasOlder, loadingOlder, olderError, onLoadOlder };

  function scrollToBottom(el: HTMLElement, smooth: boolean) {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth && !reduced ? 'smooth' : 'auto' });
  }

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const firstId = items.length > 0 ? (items[0]?.id ?? null) : null;
    const lastId = items.length > 0 ? (items[items.length - 1]?.id ?? null) : null;
    const prevFirstId = prevFirstIdRef.current;
    const prevLastId = prevLastIdRef.current;

    if (prevFirstId === null && firstId !== null) {
      // 초기 로드: 애니메이션 없이 곧장 최하단에서 시작한다.
      el.scrollTop = el.scrollHeight;
    } else if (prevFirstId !== null && firstId !== prevFirstId) {
      // prepend(이전 페이지): 늘어난 높이만큼 보정해 보던 위치를 고정한다.
      el.scrollTop += el.scrollHeight - prevHeightRef.current;
    } else if (prevLastId !== null && lastId !== prevLastId) {
      // append(새 메시지). 사용자 본인 메시지는 명세대로 무조건 최하단으로 내린다. 어시스턴트 응답
      // "도착"은 사용자가 위로 올라가 과거를 읽는 중이면 끌어내리지 않는다 - 스트리밍 추적(아래 effect)과
      // 동일한 하단 근처 판정/임계를 써서, 읽던 중 완성된 응답이 튀어 화면을 뺏지 않게 한다.
      const appended = items[items.length - 1];
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_THRESHOLD_PX;
      if (appended?.role !== 'assistant' || nearBottom) scrollToBottom(el, true);
    }

    prevFirstIdRef.current = firstId;
    prevLastIdRef.current = lastId;
    prevHeightRef.current = el.scrollHeight;
  }, [items]);

  /*
   * 검색 결과에서 들어온 이동(STEP 16). 위 앵커링 이펙트 "다음"에 선언해 같은 커밋에서 나중에 돈다 -
   * 과거 페이지를 앞에 붙이면 앵커링 보정이 먼저 스크롤을 되돌려 놓고, 그 위에서 목표 위치로 옮긴다.
   * (순서가 반대면 보정이 이동을 덮어써 엉뚱한 곳에 멈춘다.)
   *
   * 대상이 아직 목록에 없으면 아무것도 하지 않는다 - 소유자가 과거 페이지를 다 불러오면
   * items 가 바뀌면서 이 이펙트가 다시 돌고, 그때 이동한다.
   */
  useLayoutEffect(() => {
    if (!jumpToId) return;
    const el = containerRef.current;
    const target = el?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(jumpToId)}"]`);
    if (!el || !target) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
    // 포커스를 옮겨 스크린리더가 도착한 메시지를 읽게 한다(시각 사용자에게는 강조가 같은 일을 한다).
    target.focus({ preventScroll: true });
    setHighlightId(jumpToId);
    onJumpHandled?.();
  }, [jumpToId, items, onJumpHandled]);

  /* 강조는 잠깐이면 충분하다 - 남겨 두면 다음 검색 결과와 섞여 "지금 찾은 것"이 흐려진다. */
  useEffect(() => {
    if (!highlightId) return;
    const timer = setTimeout(() => setHighlightId(null), 2400);
    return () => clearTimeout(timer);
  }, [highlightId]);

  /* 대기 말풍선이 나타나거나 스트림 텍스트가 자랄 때 최하단을 유지한다. 단, 대기에
     "진입한" 순간(1회)만 명세대로 무조건 내려가고, 이후 스트림이 자라는 동안에는
     사용자가 위로 올라가 과거를 읽고 있으면 끌어내리지 않는다(하단 근처일 때만 따라감).
     실제 delta 스트리밍이 붙어 streamText 가 매 토큰 바뀌어도 읽던 위치를 지킨다. */
  const prevReplyStatusRef = useRef<ReplyStatus>(replyStatus);
  useEffect(() => {
    const el = containerRef.current;
    const enteredWaiting = prevReplyStatusRef.current !== 'waiting' && replyStatus === 'waiting';
    prevReplyStatusRef.current = replyStatus;
    if (!el || replyStatus !== 'waiting') return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_THRESHOLD_PX;
    if (enteredWaiting || nearBottom) scrollToBottom(el, true);
  }, [replyStatus, streamText]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => {
      const flags = flagsRef.current;
      // 명세 문구 그대로 "최상단 도달 시" - 소수점 스크롤 값을 감안한 1px 여유만 둔다.
      if (el.scrollTop <= 1 && flags.hasOlder && !flags.loadingOlder && !flags.olderError) {
        flags.onLoadOlder();
      }
      // "맨 아래로" 버튼(STEP 11) - 같은 리스너에 비교 하나를 더했다. 값이 같으면
      // React 가 리렌더를 생략하므로 스크롤마다 setState 를 불러도 비용이 없다.
      setShowJump(el.scrollHeight - el.scrollTop - el.clientHeight > BOTTOM_THRESHOLD_PX);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  /*
   * 날짜가 바뀌는 지점에 구분선을 끼운다(STEP 10 - 실서비스/예시 화면의 문법).
   * 표기는 시간 규칙(YYYY-MM-DD HH:mm)의 날짜부를 그대로 재사용한다.
   * prepend 로 경계가 이동하거나 구분선이 사라져도 앵커링 보정은 scrollHeight
   * 차이 기반이라 구분선의 증감분까지 자동으로 반영된다.
   */
  /* 재생성은 "목록의 마지막 메시지가 응답일 때" 그 응답에만 - 중간 응답을 지우고
     다시 받으면 대화 순서가 뒤틀린다(runReply 는 항상 마지막 질문에 응답한다). */
  const last = items[items.length - 1];
  const regenerableId =
    last && last.role === 'assistant' && replyStatus === 'idle' ? last.id : null;

  /*
   * 말풍선 노드 목록은 items(+애니메이션/재생성 대상)에서만 파생된다. useMemo 로 고정해,
   * streamText 가 매 토큰 바뀌거나 컴포저 타이핑으로 리렌더가 내려와도(둘 다 items 와 무관)
   * 수백 개 말풍선 트리를 다시 만들지 않는다. 안정 참조 콜백(onRate/onRegenerate) 계약이
   * 전제라 이들을 의존성에 넣어도 매번 바뀌지 않는다 - 실제 목록 변화에만 재구성한다.
   */
  const rows = useMemo(() => {
    const out: ReactNode[] = [];
    let prevDate: string | null = null;
    for (const message of items) {
      const date = formatDateTime(message.createdAt).slice(0, 10);
      if (date !== prevDate) {
        prevDate = date;
        out.push(
          <div key={`date-${date}`} className={styles.dateDivider}>
            {date}
          </div>,
        );
      }
      out.push(
        <MessageBubble
          key={message.id}
          message={message}
          animate={animateIds?.has(message.id) ?? false}
          highlight={message.id === highlightId}
          onRate={onRate}
          onRegenerate={message.id === regenerableId ? onRegenerateReply : undefined}
        />,
      );
    }
    return out;
  }, [items, animateIds, highlightId, regenerableId, onRate, onRegenerateReply]);

  return (
    <div className={styles.listWrap}>
      {/* role="log": 끝에 추가되는 콘텐츠를 보조기술에 예의 바르게(polite) 알리는 시맨틱. */}
      <div ref={containerRef} className={styles.scroller} role="log" aria-label="메시지 목록">
        <div className={styles.inner}>
          {loadingOlder && (
            <div className={styles.olderRow}>
              <Spinner size={16} label="이전 메시지 불러오는 중" />
            </div>
          )}
          {olderError && (
            <div className={styles.olderRow}>
              <span className={styles.olderErrorText}>이전 메시지를 불러오지 못했습니다.</span>
              <Button variant="ghost" size="sm" onClick={onLoadOlder}>
                다시 시도
              </Button>
            </div>
          )}

          {rows}

          {replyStatus === 'waiting' && (
            /* 응답과 같은 화자 헤더를 공유해 "생성 중 -> 응답" 전환에서 표시가 튀지 않는다. */
            <div className={styles.assistantRow} role="status" aria-label="응답을 생성하는 중">
              <div className={bubbleStyles.assistantBody}>
                <AssistantMeta />
                <div className={styles.waitingRow}>
                  <div className={styles.waitingBubble}>
                    {streamText ? (
                      /* delta 가 흐르기 시작하면(스트리밍 전환 예고) 자라나는 텍스트 + 생성 커서가 된다. */
                      <span className={styles.streamText}>
                        {streamText}
                        <span className={styles.caret} aria-hidden="true" />
                      </span>
                    ) : (
                      <span className={styles.dots} aria-hidden="true">
                        <span className={styles.dot} />
                        <span className={styles.dot} />
                        <span className={styles.dot} />
                      </span>
                    )}
                  </div>
                  {/* 실서비스 관례(STEP 11) - 대기 중에만 존재하고, 중단은 오류가 아니다. */}
                  <Button variant="ghost" size="sm" onClick={onStopReply}>
                    중지
                  </Button>
                </div>
              </div>
            </div>
          )}
          {replyStatus === 'error' && (
            <div className={styles.assistantRow} role="status">
              <div className={styles.errorBubble}>
                <span>응답을 받지 못했습니다.</span>
                <Button variant="ghost" size="sm" onClick={onRetryReply}>
                  재시도
                </Button>
              </div>
            </div>
          )}
          {/* 레이트리밋(#C2) - 오류가 아니라 대기다.
              눈으로 보는 카운트다운과 스크린리더가 듣는 문장을 갈라 둔다. role="status" 안에서
              숫자가 매 초 바뀌면 보조기술이 1초마다 끼어들어 방해가 되므로, 숫자는 aria-hidden
              으로 가리고 변하지 않는 한 문장을 따로 읽힌다. */}
          {replyStatus === 'rateLimited' && (
            <div className={styles.assistantRow} role="status">
              <div className={styles.cooldownBubble}>
                <span aria-hidden="true">
                  요청이 너무 잦습니다.{' '}
                  {cooldownSeconds > 0 ? (
                    <>
                      <b>{cooldownSeconds}초</b> 후 다시 시도할 수 있습니다.
                    </>
                  ) : (
                    '이제 다시 시도할 수 있습니다.'
                  )}
                </span>
                <span className="srOnly">
                  요청이 너무 잦아 잠시 기다려야 합니다. 재시도 버튼이 활성화되면 다시 시도할 수
                  있습니다.
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onRetryReply}
                  disabled={cooldownSeconds > 0}
                >
                  재시도
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {showJump && (
        <button
          type="button"
          className={styles.jumpButton}
          onClick={() => {
            const el = containerRef.current;
            if (el) scrollToBottom(el, true);
          }}
          aria-label="맨 아래로 이동"
        >
          ↓
        </button>
      )}
    </div>
  );
});

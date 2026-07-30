'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  ChatApiError,
  type ChatRoom as ChatRoomModel,
  type MessageRating,
} from '@chat/chat-domain';
import { Button, Spinner, useToast } from '@chat/ui';
import { chatApi, isTransportFailure } from '@/lib/api/chatApi';
import { refreshRooms } from '@/lib/chat-store/roomsStore';
import { reportRequestOutcome } from '@/lib/network/networkQuality';
import { clearRoomDraft, readRoomDraft, saveRoomDraft, takePendingMessage } from '@/lib/draft';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useMessages } from '@/hooks/useMessages';
import { MessageComposer } from '@/components/composer/MessageComposer';
import { MessageList, type ReplyStatus } from './MessageList';
import styles from './ChatRoom.module.css';

type RoomState =
  | { status: 'loading' }
  | { status: 'ready'; room: ChatRoomModel }
  | { status: 'not-found' }
  | { status: 'error' };

/**
 * 채팅방(/c/[chatId]) - 방 존재 확인을 통과해야 본문(RoomBody)이 마운트된다.
 *
 * 삭제된 방의 URL 로 직접 진입하는 경우(NOT_FOUND)는 흔한 경로다: 브라우저 히스토리,
 * 다른 탭에서의 삭제. 404 대신 안내와 홈 복귀를 준다.
 */
export function ChatRoom({ chatId }: { chatId: string }) {
  const [state, setState] = useState<RoomState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    chatApi
      .getChatRoom(chatId)
      .then((room) => {
        if (!cancelled) setState({ status: 'ready', room });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ChatApiError && error.code === 'NOT_FOUND') {
          setState({ status: 'not-found' });
        } else {
          setState({ status: 'error' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [chatId, attempt]);

  if (state.status === 'loading') {
    return (
      <div className={styles.center}>
        <Spinner size={22} label="채팅방 불러오는 중" />
      </div>
    );
  }

  if (state.status === 'not-found') {
    return (
      <div className={styles.center} role="status">
        <p className={styles.noticeTitle}>존재하지 않는 채팅방입니다</p>
        <p className={styles.noticeBody}>삭제되었거나 잘못된 주소일 수 있습니다.</p>
        <Link href="/" className={styles.homeLink}>
          채팅 홈으로 이동
        </Link>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className={styles.center} role="status">
        <p className={styles.noticeTitle}>채팅방을 불러오지 못했습니다</p>
        <p className={styles.noticeBody}>네트워크 상태를 확인해 주세요.</p>
        <Button variant="ghost" size="sm" onClick={() => setAttempt((n) => n + 1)}>
          다시 시도
        </Button>
      </div>
    );
  }

  /* key=방 id: 방 전환 시 본문을 통째로 리마운트해 입력값/응답 상태/1회성 가드가 방마다 독립이다. */
  return <RoomBody key={state.room.id} room={state.room} />;
}

function RoomBody({ room }: { room: ChatRoomModel }) {
  /* 탭/히스토리에서 어느 방인지 구분되게 - 방을 나가면 기본 타이틀로 복원된다. */
  useDocumentTitle(`${room.title} - AI Chat`);
  const { showToast } = useToast();
  const messages = useMessages(room.id);
  /* 훅이 useCallback 으로 고정한 안정 참조들 - 콜백 의존성과 memo 목록의 props 로 안전하다. */
  const { append, replace, remove, loadOlder, loadUntilMessage, retryInitial } = messages;
  /* 방별 드래프트 복원(STEP 11). RoomBody 는 방 로드 뒤 클라이언트에서만 마운트되므로
     lazy init 이 SSR 마크업과 어긋날 일이 없다(홈과 달리 useEffect 복원이 불필요). */
  const [value, setValue] = useState(() => readRoomDraft(room.id));
  const [reply, setReply] = useState<{ status: ReplyStatus; text: string }>({
    status: 'idle',
    text: '',
  });
  /**
   * 429 를 받고 남은 대기 초(#C2). 0 이면 대기 없음.
   *
   * 서버가 준 값을 그대로 세는 이유: 남은 시간을 클라이언트가 추정하면 서버의 버킷 상태와
   * 어긋나 "0 이 됐는데 또 429" 가 난다. 판정의 출처는 서버 하나다.
   */
  const [cooldown, setCooldown] = useState(0);
  const [sendError, setSendError] = useState(false);
  const [sending, setSending] = useState(false);
  /** 홈이 남긴 첫 메시지는 정확히 한 번만 전송한다(리렌더 가드 - 저장소 소비는 그 자체로 1회성). */
  const pendingHandledRef = useRef(false);
  /**
   * 이번 마운트에서 "응답으로 도착한" 메시지 id(5단계 페이드 인 대상).
   * 저장 데이터에 표시를 남기지 않는 이유: 같은 메시지가 새로고침 뒤에는 기존
   * 목록으로 로드되는데, 그때는 애니메이션이 없어야 한다 - 즉 이것은 메시지의
   * 속성이 아니라 "도착 순간" 의 속성이고, 방을 나가면 함께 버려진다.
   */
  const animateIdsRef = useRef<Set<string>>(new Set());

  /*
   * 검색 결과에서 들어온 이동(STEP 16). 사이드바가 /c/<방>?m=<메시지> 로 보내면, 그 메시지가
   * 목록에 들어올 때까지 과거 페이지를 되짚어 불러온 뒤 목록에 "이 메시지로 가라"고 넘긴다.
   *
   * 이동을 마치면 쿼리를 지운다(replace). 남겨 두면 같은 결과를 다시 눌러도 URL 이 그대로라
   * 아무 일도 안 일어난다 - 사용자에게는 링크가 죽은 것으로 보인다.
   */
  const router = useRouter();
  const pathname = usePathname();
  const requestedMessageId = useSearchParams().get('m');
  const [jumpToId, setJumpToId] = useState<string | null>(null);

  useEffect(() => {
    if (!requestedMessageId || messages.status !== 'ready') return;
    let cancelled = false;
    void loadUntilMessage(requestedMessageId).then((found) => {
      if (cancelled) return;
      if (found) {
        setJumpToId(requestedMessageId);
      } else {
        // 다른 탭에서 지워졌거나 너무 오래된 경우. 조용히 실패하지 않고 이유를 말한다.
        showToast('그 메시지를 찾지 못했습니다. 삭제되었을 수 있습니다.', { variant: 'error' });
        router.replace(pathname, { scroll: false });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [requestedMessageId, messages.status, loadUntilMessage, router, pathname, showToast]);

  const handleJumpHandled = useCallback(() => {
    setJumpToId(null);
    router.replace(pathname, { scroll: false });
  }, [router, pathname]);

  /**
   * 응답 스트림 소비. mock 은 2초 뒤 'done' 하나지만 for-await 로 돌아
   * 추후 'delta' 가 흐르기 시작해도 이 코드는 그대로다(개요의 스트리밍 전환 예고).
   * streamReply 는 계측 래퍼 밖이므로(시작~완료가 한 번의 요청이 아님)
   * 완료/실패 시점의 보고를 소비자인 여기가 맡는다.
   */
  /** 진행 중 응답 스트림의 중단 손잡이(STEP 11). 응답 사이클 밖에서는 null 이다. */
  const replyAbortRef = useRef<AbortController | null>(null);

  const runReply = useCallback(async () => {
    const controller = new AbortController();
    replyAbortRef.current = controller;
    setReply({ status: 'waiting', text: '' });
    const startedAt = Date.now();
    try {
      let sawDelta = false;
      for await (const event of chatApi.streamReply(room.id, { signal: controller.signal })) {
        if (event.type === 'delta') {
          sawDelta = true;
          setReply((prev) => ({ status: 'waiting', text: prev.text + event.text }));
        } else {
          // 도착 기록 - 이 메시지만 페이드 인. 단 delta 가 이미 순차 노출을 수행했다면
          // (STEP 12 스트림 데모) 같은 텍스트를 두 번 재생하지 않는다.
          if (!sawDelta) animateIdsRef.current.add(event.message.id);
          // append 와 대기 말풍선 제거를 같은 동기 틱에 함께 커밋한다(React 18 자동 배치). 이 둘이
          // for-await 의 .next() await 경계로 갈리면, append 직후 한 프레임 동안 "새 말풍선 + 아직
          // waiting(streamText=전체 응답)" 이 겹쳐 delta/SSE 경로에서 응답이 두 번 보이는 플래시가 난다.
          append(event.message);
          setReply({ status: 'idle', text: '' });
        }
      }
      reportRequestOutcome({ durationMs: Date.now() - startedAt, ok: true });
      // 최종 메시지 이벤트가 위 done 분기에서 idle 로 전환했으면(정상 경로) 여기선 같은 값이라 갱신을
      // 건너뛴다(함수형 가드). 스트림이 메시지 없이 끝난 비정상 경로만 여기서 대기 상태를 정리한다.
      setReply((prev) => (prev.status === 'waiting' ? { status: 'idle', text: '' } : prev));
      void refreshRooms(); // 사이드바 미리보기·정렬 갱신
    } catch (error) {
      if (controller.signal.aborted) {
        // 사용자 중단(STEP 11)은 오류가 아니다 - 에러 행도, 품질 관측(나쁜 요청
        // 집계)도 남기지 않는다. 회선 문제가 아니라 사용자의 선택이기 때문이다.
        setReply({ status: 'idle', text: '' });
        return;
      }
      // /error 데모(REPLY_FAILED)는 도메인 거절이라 네트워크 배너 관측에서 제외한다.
      reportRequestOutcome({ durationMs: Date.now() - startedAt, ok: !isTransportFailure(error) });
      // 레이트리밋은 실패가 아니라 "아직"이다 - 회복 시점이 정해져 있으므로 다른 상태로 둔다.
      if (error instanceof ChatApiError && error.code === 'RATE_LIMITED') {
        setCooldown(Math.max(1, error.retryAfterSeconds ?? 1));
        setReply({ status: 'rateLimited', text: '' });
        return;
      }
      setReply({ status: 'error', text: '' });
    } finally {
      replyAbortRef.current = null;
    }
  }, [room.id, append]);

  /** 대기 말풍선의 중지 버튼이 부른다(STEP 11). */
  const stopReply = useCallback(() => {
    replyAbortRef.current?.abort();
  }, []);

  const cooling = cooldown > 0;

  /**
   * 대기 초 카운트다운(#C2). 1초 간격으로 줄이고 0 에서 타이머를 정리한다.
   *
   * 의존성이 `cooldown` 이 아니라 `cooling`(0 인지 아닌지)인 것이 요점이다. 남은 초를 의존성에
   * 넣으면 매 초 타이머를 지우고 다시 걸어 한 주기마다 렌더 시간만큼 드리프트가 쌓인다.
   * 값은 함수형 갱신으로 줄이므로 이 효과는 대기의 시작과 끝에서만 한 번씩 돈다.
   */
  useEffect(() => {
    if (!cooling) return;
    const timer = window.setInterval(() => {
      setCooldown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooling]);

  /** 대기가 끝난 뒤의 재시도. 남은 시간이 있으면 아무 것도 하지 않는다(버튼도 비활성이다). */
  const retryAfterCooldown = useCallback(() => {
    if (cooldown > 0) return;
    setReply({ status: 'idle', text: '' });
    void runReply();
  }, [cooldown, runReply]);

  /** 응답 피드백(STEP 11) - API 가 돌려준 갱신본으로 그 말풍선 하나만 교체된다. */
  const rate = useCallback(
    async (messageId: string, rating: MessageRating | null) => {
      try {
        replace(await chatApi.rateMessage(room.id, messageId, rating));
      } catch {
        showToast('피드백을 저장하지 못했습니다. 네트워크 상태를 확인해 주세요.', {
          variant: 'error',
        });
      }
    },
    [room.id, replace, showToast],
  );

  /**
   * 응답 재생성(STEP 11) - 마지막 응답을 지우고 같은 질문에 새 응답을 받는다.
   * 삭제가 성공한 뒤에만 목록에서 빼고 재응답을 시작한다(실패 시 화면 불변).
   */
  const regenerate = useCallback(
    async (messageId: string) => {
      setSending(true);
      try {
        await chatApi.deleteMessage(room.id, messageId);
      } catch {
        showToast('응답을 다시 생성하지 못했습니다. 네트워크 상태를 확인해 주세요.', {
          variant: 'error',
        });
        setSending(false);
        return;
      }
      animateIdsRef.current.delete(messageId);
      remove(messageId);
      setSending(false);
      await runReply();
    },
    [room.id, remove, runReply, showToast],
  );

  const send = useCallback(
    async (content: string) => {
      setSending(true);
      setSendError(false);
      try {
        const message = await chatApi.sendMessage(room.id, content);
        append(message);
        setValue(''); // 홈과 같은 규칙 - 성공했을 때만 입력을 비운다
        clearRoomDraft(room.id); // 드래프트도 같은 시점에만(STEP 11)
        void refreshRooms();
        await runReply();
      } catch {
        setSendError(true);
      } finally {
        setSending(false);
      }
    },
    [room.id, append, runReply],
  );

  /** 입력은 방별 드래프트로 write-through(STEP 11) - 홈 드래프트와 같은 규칙이다. */
  const handleChange = useCallback(
    (next: string) => {
      setValue(next);
      saveRoomDraft(room.id, next);
    },
    [room.id],
  );

  /**
   * 명세: "채팅홈에서 진입 시 입력한 내용으로 즉시 메시지가 전송되어야 함".
   * 홈이 sessionStorage 에 남긴 핸드오프를 초기 목록이 준비된 뒤 소비한다.
   * takePendingMessage 는 읽으면서 지우므로(1회 소비) 새로고침/StrictMode
   * 재마운트에도 중복 전송이 구조적으로 불가능하다.
   */
  useEffect(() => {
    if (messages.status !== 'ready' || pendingHandledRef.current) return;
    pendingHandledRef.current = true;
    const pending = takePendingMessage(room.id);
    if (pending) void send(pending);
  }, [messages.status, room.id, send]);

  // 대기 중에는 입력도 잠근다(#C2) - 보낼 수 없는 상태에서 입력을 받아 두면 사용자는 전송된
  // 줄 알고, 실제로는 또 429 를 받는다. 잠그는 대상은 남은 시간이 있는 동안뿐이다.
  const busy = sending || reply.status === 'waiting' || cooling;

  return (
    <div className={styles.room}>
      <header className={styles.header}>
        <h1 className={styles.title}>{room.title}</h1>
      </header>

      {messages.status === 'loading' && (
        <div className={styles.center}>
          <Spinner size={22} label="메시지 불러오는 중" />
        </div>
      )}

      {messages.status === 'error' && (
        <div className={styles.center} role="status">
          <p className={styles.noticeTitle}>메시지를 불러오지 못했습니다</p>
          <Button variant="ghost" size="sm" onClick={retryInitial}>
            다시 시도
          </Button>
        </div>
      )}

      {messages.status === 'ready' && (
        /* 콜백은 인라인 화살표가 아니라 안정 참조를 넘긴다 - 매 렌더 새 함수를
           만들면 목록의 memo 가 무력화된다(loadOlder/runReply 는 내부에서 실패를
           삼키므로 반환 Promise 를 버려도 unhandled rejection 이 없다). */
        <MessageList
          items={messages.items}
          hasOlder={messages.nextBefore !== null}
          loadingOlder={messages.loadingOlder}
          olderError={messages.olderError}
          onLoadOlder={loadOlder}
          replyStatus={reply.status}
          streamText={reply.text}
          onRetryReply={reply.status === 'rateLimited' ? retryAfterCooldown : runReply}
          cooldownSeconds={cooldown}
          onStopReply={stopReply}
          onRate={rate}
          onRegenerateReply={regenerate}
          animateIds={animateIdsRef.current}
          jumpToId={jumpToId}
          onJumpHandled={handleJumpHandled}
        />
      )}

      <div className={styles.composerArea}>
        <div className={styles.composerInner}>
          {room.type === 'receive-only' ? (
            /* 알림톡형 방(개요 예고) - 입력 폼 대신 안내를 둔다. mock 도 이 방의
               전송을 거부하므로(RECEIVE_ONLY) 타입이 스키마 장식이 아니라 규칙이다. */
            <p className={styles.receiveOnlyNotice}>
              받은 메시지 전용 채팅방입니다. 답장을 보낼 수 없습니다.
            </p>
          ) : (
            <>
              {sendError && (
                <p role="alert" className={styles.sendError}>
                  메시지를 전송하지 못했습니다. 네트워크 상태를 확인하고 다시 시도해 주세요.
                </p>
              )}
              <MessageComposer
                value={value}
                onChange={handleChange}
                onSubmit={(content) => void send(content)}
                disabled={busy}
                autoFocus
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

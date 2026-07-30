'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Message } from '@chat/chat-domain';
import { chatApi } from '@/lib/api/chatApi';

export interface MessagesState {
  /** 최초 페이지 로드 상태. 이전 페이지 로드는 loadingOlder 로 분리한다. */
  status: 'loading' | 'ready' | 'error';
  /** 시간 오름차순 - API 페이지(items 오름차순)를 앞으로 이어 붙인 결과. */
  items: Message[];
  /** 더 오래된 페이지 커서. null 이면 끝(첫 페이지까지 다 봤다). */
  nextBefore: string | null;
  loadingOlder: boolean;
  /** 이전 페이지 로드 실패 - 최상단에 재시도를 노출한다(관찰자는 실패 후 재발화하지 않으므로). */
  olderError: boolean;
}

const INITIAL: MessagesState = {
  status: 'loading',
  items: [],
  nextBefore: null,
  loadingOlder: false,
  olderError: false,
};

/**
 * 채팅방 메시지 목록 - 50개 단위 역방향(과거로) 커서 페이지네이션.
 *
 * roomsStore 와 달리 모듈 싱글턴이 아니라 컴포넌트 스코프 훅이다: 메시지는
 * "지금 보고 있는 방" 의 상태라서 방을 나가면 버려도 되고, 방마다 캐시를
 * 유지하라는 요구도 없다. 전역화는 필요해질 때(방 전환 캐시) 하면 된다.
 */
export function useMessages(chatId: string) {
  const [state, setState] = useState<MessagesState>(INITIAL);
  /** 초기 로드 재시도용 - 값이 바뀌면 로드 이펙트가 다시 돈다. */
  const [attempt, setAttempt] = useState(0);
  /** loadOlder 의 최신 상태 참조(stale closure 방지)와 중복 호출 가드. */
  const stateRef = useRef(state);
  stateRef.current = state;
  const olderInflight = useRef(false);

  useEffect(() => {
    // StrictMode 는 mount-unmount-mount 로 이펙트를 두 번 돌린다.
    // 첫 실행의 응답은 cancelled 로 버려져 마지막 마운트의 상태만 남는다(읽기라 부작용 없음).
    let cancelled = false;
    setState(INITIAL);
    chatApi
      .listMessages({ chatId })
      .then((page) => {
        if (cancelled) return;
        setState({
          status: 'ready',
          items: page.items,
          nextBefore: page.nextBefore,
          loadingOlder: false,
          olderError: false,
        });
      })
      .catch(() => {
        if (!cancelled) setState({ ...INITIAL, status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [chatId, attempt]);

  const retryInitial = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  /** 스크롤 최상단 도달 시 이전 50개를 앞으로 이어 붙인다. */
  const loadOlder = useCallback(async () => {
    const current = stateRef.current;
    if (current.status !== 'ready' || !current.nextBefore || olderInflight.current) return;
    olderInflight.current = true;
    setState((prev) => ({ ...prev, loadingOlder: true, olderError: false }));
    try {
      const page = await chatApi.listMessages({ chatId, before: current.nextBefore });
      setState((prev) => ({
        ...prev,
        items: [...page.items, ...prev.items],
        nextBefore: page.nextBefore,
        loadingOlder: false,
      }));
    } catch {
      setState((prev) => ({ ...prev, loadingOlder: false, olderError: true }));
    } finally {
      olderInflight.current = false;
    }
  }, [chatId]);

  /**
   * 특정 메시지가 목록에 들어올 때까지 과거 페이지를 되짚어 불러온다(STEP 16 - 검색 결과 이동).
   *
   * loadOlder 를 반복 호출하지 않는 이유: 그 함수는 setState 로만 결과를 알려주므로, 루프가
   * "다음 커서"를 알려면 리렌더를 기다려야 한다(await 로는 보장되지 않는 경합). 여기서는 커서를
   * 지역 변수로 이어 가며 필요한 페이지를 다 모은 뒤 **한 번만** 앞에 붙인다 - 목록 상단
   * 앵커링 보정도 한 번만 일어나 화면이 여러 번 튀지 않는다.
   *
   * 상한(maxPages)은 안전장치다. 검색이 가리키는 메시지가 (다른 탭에서) 지워졌다면 커서는
   * 계속 나오는데 목표는 영영 안 나올 수 있다 - 그때 무한 루프 대신 실패로 끝낸다.
   */
  const loadUntilMessage = useCallback(
    async (messageId: string, maxPages = 20): Promise<boolean> => {
      const current = stateRef.current;
      if (current.items.some((m) => m.id === messageId)) return true;
      if (current.status !== 'ready') return false;

      let before = current.nextBefore;
      const collected: Message[] = [];
      let found = false;
      for (let page = 0; page < maxPages && before && !found; page++) {
        const loaded = await chatApi.listMessages({ chatId, before });
        collected.unshift(...loaded.items);
        before = loaded.nextBefore;
        found = loaded.items.some((m) => m.id === messageId);
      }
      if (collected.length > 0) {
        const nextBefore = before;
        setState((prev) =>
          prev.status === 'ready'
            ? { ...prev, items: [...collected, ...prev.items], nextBefore }
            : prev,
        );
      }
      return found;
    },
    [chatId],
  );

  /** 전송/응답으로 생긴 새 메시지를 목록 끝에 붙인다(재조회 없이 - 이미 확정된 값이다). */
  const append = useCallback((message: Message) => {
    setState((prev) =>
      prev.status === 'ready' ? { ...prev, items: [...prev.items, message] } : prev,
    );
  }, []);

  /** API 가 돌려준 갱신본으로 한 건을 교체한다(피드백, STEP 11). 참조가 바뀌므로
      memo 된 말풍선 중 정확히 그 하나만 다시 그려진다. */
  const replace = useCallback((message: Message) => {
    setState((prev) =>
      prev.status === 'ready'
        ? { ...prev, items: prev.items.map((m) => (m.id === message.id ? message : m)) }
        : prev,
    );
  }, []);

  /** 한 건을 목록에서 제거한다(재생성, STEP 11). */
  const remove = useCallback((messageId: string) => {
    setState((prev) =>
      prev.status === 'ready'
        ? { ...prev, items: prev.items.filter((m) => m.id !== messageId) }
        : prev,
    );
  }, []);

  return { ...state, loadOlder, loadUntilMessage, append, replace, remove, retryInitial };
}

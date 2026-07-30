'use client';

import { useEffect, useSyncExternalStore } from 'react';
import type { ChatRoomSummary } from '@chat/chat-domain';
import { chatApi } from '@/lib/api/chatApi';
import { clearRoomDraft } from '@/lib/draft';

/**
 * 채팅방 목록 스토어.
 *
 * TanStack Query 를 배제한 결정(README 버전 정책)의 후속이다. 이 앱의 서버 상태는
 * "방 목록 하나 + 방별 메시지" 뿐이라, 필요한 패턴(stale-while-revalidate,
 * 요청 중복 제거, 외부 스토어 구독)만 직접 구현했다.
 *
 * 사이드바는 루트 레이아웃 소유라 페이지를 오가도 마운트가 유지된다(STEP 1).
 * 목록을 바꾸는 쪽(생성/삭제/전송)은 조작 후 refreshRooms() 를 부른다 - 정렬 규칙
 * (마지막 대화 내림차순)의 진실원은 API 이므로, 프론트에서 재정렬하지 않고 재조회한다.
 */
export interface RoomsState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  rooms: ChatRoomSummary[];
}

const INITIAL: RoomsState = { status: 'idle', rooms: [] };

let state: RoomsState = INITIAL;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function setState(next: RoomsState) {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function refreshRooms(): Promise<void> {
  // 진행 중이면 그 요청을 공유한다(StrictMode 이중 실행, 동시 갱신 요청 흡수).
  if (inflight) return inflight;

  // 이미 데이터가 있으면 stale 을 보여주며 뒤에서 갱신한다(화면 깜빡임 없음).
  if (state.status !== 'ready') setState({ ...state, status: 'loading' });

  inflight = chatApi
    .listChatRooms()
    .then((rooms) => setState({ status: 'ready', rooms }))
    .catch(() => {
      // stale 이 있으면 유지한다 - 실패 자체는 네트워크 배너가 알리고 있다.
      if (state.rooms.length > 0) setState({ status: 'ready', rooms: state.rooms });
      else setState({ status: 'error', rooms: [] });
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** 삭제는 성공 후 재조회로 화면을 확정한다(낙관적 갱신 대신 정확성 우선). */
export async function deleteRoom(chatId: string): Promise<void> {
  await chatApi.deleteChatRoom(chatId);
  clearRoomDraft(chatId); // 방과 함께 드래프트도 - 고아 키를 남기지 않는다(STEP 11)
  await refreshRooms();
}

export function useRooms(): RoomsState {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => state,
    () => INITIAL,
  );

  useEffect(() => {
    if (snapshot.status === 'idle') void refreshRooms();
  }, [snapshot.status]);

  /*
   * 다중 탭 동기화 - STEP 2 가 한계로 명시했던 "다른 탭의 수정을 모른다"의 절반을 닫는다.
   * storage 이벤트는 '다른 탭'이 localStorage 를 썼을 때만 발생하므로(자기 쓰기는 제외)
   * 그대로 재조회 트리거로 쓰기에 정확하다. 범위는 방 목록까지다 - 열려 있는 방의
   * 메시지 목록까지 실시간 동기화하는 것은 읽던 위치(스크롤)를 흔들 수 있어,
   * 실서버(소켓) 전환 시 정식 채널로 다루는 편이 맞다.
   */
  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key !== 'ai-chat/v1') return;
      // 이벤트만으로는 부족하다 - mock 이 상태를 메모리에 캐시하므로, 캐시를
      // 버려야 재조회가 저장소의 새 값을 실제로 읽는다.
      chatApi.invalidateCache();
      void refreshRooms();
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return snapshot;
}

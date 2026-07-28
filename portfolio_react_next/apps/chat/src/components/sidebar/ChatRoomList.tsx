'use client';

import { useEffect, useState, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { formatDateTime, type ChatRoomSummary, type MessageSearchHit } from '@chat/chat-domain';
import { Button, Dialog, cn, splitByTerms, useToast } from '@chat/ui';
import { chatApi } from '@/lib/api/chatApi';
import { deleteRoom, refreshRooms, useRooms } from '@/lib/chat-store/roomsStore';
import { SIDEBAR_COLLAPSE_EVENT } from '@/components/app-shell/SidebarToggle';
import styles from './ChatRoomList.module.css';

/**
 * 채팅방 목록 - 루트 레이아웃의 사이드바 슬롯에 들어가 홈/채팅방이 공유한다.
 * 정렬(마지막 대화 내림차순)은 API 가 보장하므로 여기서는 그리기만 한다.
 *
 * 제목 수정은 인라인 편집이다(연필 -> 입력 -> Enter 확정 / Esc 취소).
 * 2단계부터 있던 renameChatRoom API 를 소비하는 UI - 편집 중에는 항목의 링크를
 * 입력 폼으로 교체해, 글자를 고치려는 클릭이 방 이동으로 새지 않게 한다.
 *
 * 검색(STEP 10 -> 16) - 와이어프레임의 돋보기에서 출발했다. 방 제목/미리보기는 이미
 * 클라이언트에 다 있어 부분일치 필터로 충분했고, "메시지 본문 전문 검색은 나중에" 로
 * 남겨 두었다. 그 자리를 STEP 16 에서 채운다: 같은 입력에 모드를 하나 더 두어,
 * '대화 내용' 이면 모든 방의 메시지를 관련도 순으로 찾고 결과에서 그 메시지로 곧장 이동한다.
 * 검색 자체는 도메인(chatApi.searchMessages)이 하고 여기서는 입력·표시만 한다.
 */
type SearchMode = 'rooms' | 'messages';

/** 타이핑마다 검색하지 않게 하는 지연(ms). 한글 입력은 조합 중에도 change 가 계속 온다. */
const SEARCH_DEBOUNCE_MS = 250;
export function ChatRoomList() {
  const { status, rooms } = useRooms();
  const pathname = usePathname();
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<SearchMode>('rooms');
  const [hits, setHits] = useState<MessageSearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ChatRoomSummary | null>(null);
  const { showToast } = useToast();

  /*
   * 대화 내용 검색(STEP 16). 이 훅은 아래 조기 반환(스켈레톤/오류/빈 목록)보다 반드시 위에 있어야
   * 한다 - 훅 호출이 조건부가 되면 목록 상태가 바뀔 때 훅 순서가 어긋난다.
   *
   * 입력이 멈춘 뒤에만 질의하고(디바운스), 늦게 온 응답이 최신 결과를 덮지 않게 취소 플래그로
   * 막는다 - "ㅎ" 의 결과가 "회고" 의 결과를 밀어내는 흔한 경합이다.
   */
  useEffect(() => {
    if (mode !== 'messages' || !query.trim()) {
      setHits(null);
      setSearching(false);
      return;
    }
    const trimmed = query.trim();
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      chatApi
        .searchMessages(trimmed, { limit: 20 })
        .then((found) => {
          if (!cancelled) setHits(found);
        })
        .catch(() => {
          // 검색 실패는 빈 결과로 낮춘다 - 사이드바에 오류 상자를 띄우기보다 목록이 비는 편이 조용하다.
          if (!cancelled) setHits([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [mode, query]);

  // 삭제는 디자인 시스템 Dialog 로 확인받는다(네이티브 confirm 대체). 버튼은 대화상자만 연다.
  function handleDelete(room: ChatRoomSummary) {
    setPendingDelete(room);
  }

  async function confirmDelete() {
    const room = pendingDelete;
    if (!room) return;
    setPendingDelete(null);
    const wasActive = pathname === `/c/${room.id}`;
    try {
      await deleteRoom(room.id);
      if (wasActive) router.replace('/');
    } catch {
      showToast('삭제하지 못했습니다. 네트워크 상태를 확인해 주세요.', { variant: 'error' });
    }
  }

  function startEdit(room: ChatRoomSummary) {
    setEditingId(room.id);
    setEditValue(room.title);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditValue('');
  }

  async function confirmEdit(room: ChatRoomSummary) {
    const next = editValue.trim();
    // 비었거나 그대로면 조용히 취소한다 - 실수로 Enter 를 눌러도 잃는 것이 없다.
    if (!next || next === room.title) {
      cancelEdit();
      return;
    }
    try {
      await chatApi.renameChatRoom(room.id, next);
      cancelEdit();
      await refreshRooms();
    } catch {
      showToast('제목을 수정하지 못했습니다. 네트워크 상태를 확인해 주세요.', { variant: 'error' });
    }
  }

  /** 좁은 화면(오버레이 모드)에서는 방 선택이 곧 목록 닫기다(STEP 14, 드로어 관례). */
  function handleNavigate() {
    if (window.matchMedia('(max-width: 640px)').matches) {
      window.dispatchEvent(new Event(SIDEBAR_COLLAPSE_EVENT));
    }
  }

  function handleEditKeyDown(event: KeyboardEvent<HTMLInputElement>, room: ChatRoomSummary) {
    // 컴포저와 같은 IME 가드 - 조합 중 Enter 로 마지막 글자가 중복 확정되지 않게.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      void confirmEdit(room);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelEdit();
    }
  }

  if (status === 'idle' || (status === 'loading' && rooms.length === 0)) {
    // 스피너 대신 스켈레톤: 짧은 로드(150ms)에서 스피너는 번쩍임이 되고, 스켈레톤은
    // 최종 레이아웃의 미리보기가 된다(근거는 CSS 의 스켈레톤 절). 시각적 뼈대는
    // 보조기술에 소음이라 숨기고, 상태 텍스트만 role="status" 로 전달한다.
    return (
      <div className={styles.skeletonList} role="status" aria-label="채팅방 목록 불러오는 중">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className={styles.skeletonItem} aria-hidden="true">
            <span className={cn(styles.skeletonBar, styles.skeletonTitle)} />
            <span className={cn(styles.skeletonBar, styles.skeletonPreview)} />
          </div>
        ))}
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className={styles.center}>
        <p className={styles.muted}>목록을 불러오지 못했습니다.</p>
        <Button variant="ghost" size="sm" onClick={() => void refreshRooms()}>
          다시 시도
        </Button>
      </div>
    );
  }

  if (rooms.length === 0) {
    return (
      <div className={styles.center}>
        <p className={styles.muted}>
          아직 채팅방이 없습니다.
          <br />
          메시지를 보내면 새 채팅방이 생깁니다.
        </p>
      </div>
    );
  }

  // 제목 또는 마지막 대화 미리보기에 대한 부분 일치 필터. 정렬은 원본(API) 순서를 보존한다.
  const normalized = query.trim().toLowerCase();
  const visible = normalized
    ? rooms.filter(
        (room) =>
          room.title.toLowerCase().includes(normalized) ||
          (room.lastMessagePreview ?? '').toLowerCase().includes(normalized),
      )
    : rooms;

  return (
    <>
      {/* 스크롤 컨테이너(sidebarBody) 상단에 고정 - 목록이 길어도 검색은 항상 보인다 */}
      <div className={styles.searchRow}>
        <input
          type="search"
          className={styles.searchInput}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            // 필터로 편집 중 항목이 목록에서 사라지면 유령 편집 상태가 남는다 - 함께 닫는다.
            if (editingId) cancelEdit();
          }}
          placeholder={mode === 'rooms' ? '채팅방 검색' : '대화 내용 검색'}
          aria-label={mode === 'rooms' ? '채팅방 검색' : '대화 내용 검색'}
        />
        {/* 같은 입력에 대상만 바꾼다 - 방 제목(부분일치)과 대화 본문(관련도 랭킹)은 서로 다른 검색이다. */}
        <div className={styles.searchModes} role="group" aria-label="검색 대상">
          <button
            type="button"
            className={cn(styles.searchMode, mode === 'rooms' && styles.searchModeOn)}
            aria-pressed={mode === 'rooms'}
            onClick={() => setMode('rooms')}
          >
            방 제목
          </button>
          <button
            type="button"
            className={cn(styles.searchMode, mode === 'messages' && styles.searchModeOn)}
            aria-pressed={mode === 'messages'}
            onClick={() => setMode('messages')}
          >
            대화 내용
          </button>
        </div>
      </div>

      {mode === 'messages' ? (
        <MessageHits
          query={query}
          hits={hits}
          searching={searching}
          onNavigate={handleNavigate}
        />
      ) : visible.length === 0 ? (
        <div className={styles.center} role="status">
          <p className={styles.muted}>검색과 일치하는 채팅방이 없습니다.</p>
        </div>
      ) : (
        <ul className={styles.list}>
          {visible.map((room) => {
            const active = pathname === `/c/${room.id}`;
            const editing = editingId === room.id;

            if (editing) {
              return (
                <li key={room.id} className={styles.item}>
                  <div className={cn(styles.link, active && styles.active)}>
                    <input
                      className={styles.editInput}
                      value={editValue}
                      onChange={(event) => setEditValue(event.target.value)}
                      onKeyDown={(event) => handleEditKeyDown(event, room)}
                      onBlur={cancelEdit}
                      aria-label={`'${room.title}' 채팅방 제목 수정`}
                      autoFocus
                    />
                    <span className={styles.editHint}>Enter 저장 · Esc 취소</span>
                  </div>
                </li>
              );
            }

            return (
              <li key={room.id} className={styles.item}>
                <Link
                  href={`/c/${room.id}`}
                  className={cn(styles.link, active && styles.active)}
                  aria-current={active ? 'page' : undefined}
                  onClick={handleNavigate}
                >
                  <span className={styles.titleRow}>
                    <span className={styles.title}>
                      {room.type === 'receive-only' && (
                        <span className={styles.badge}>공지</span>
                      )}
                      {room.title}
                    </span>
                    <time className={styles.time}>
                      {formatDateTime(room.lastMessageAt ?? room.createdAt)}
                    </time>
                  </span>
                  <span className={styles.preview}>
                    {room.lastMessagePreview ?? '아직 대화가 없습니다'}
                  </span>
                </Link>
                <span className={styles.actions}>
                  <Button
                    variant="ghost"
                    size="xs"
                    iconOnly
                    aria-label={`'${room.title}' 채팅방 제목 수정`}
                    onClick={() => startEdit(room)}
                  >
                    ✎
                  </Button>
                  <Button
                    variant="danger"
                    size="xs"
                    iconOnly
                    aria-label={`'${room.title}' 채팅방 삭제`}
                    onClick={() => handleDelete(room)}
                  >
                    ✕
                  </Button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {/* 대화 검색 결과는 방 목록을 대체한다 - 두 목록을 동시에 보여주면 사이드바가 무엇을 고르는
          화면인지 흐려진다. */}
      <Dialog
        open={pendingDelete !== null}
        title="채팅방 삭제"
        destructive
        confirmLabel="삭제"
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      >
        {pendingDelete
          ? `'${pendingDelete.title}' 채팅방을 삭제할까요? 이 작업은 되돌릴 수 없습니다.`
          : null}
      </Dialog>
    </>
  );
}

/**
 * 대화 검색 결과 목록. 결과 한 줄은 "어느 방의 어느 메시지"이고, 누르면 그 방으로 이동하면서
 * ?m=<messageId> 를 달아 준다 - 방은 그 메시지가 나올 때까지 과거 페이지를 되짚어 데려간다.
 * Link 로 두는 이유: 새 탭/가운데 클릭/키보드가 브라우저 기본 동작으로 그대로 동작한다.
 */
function MessageHits({
  query,
  hits,
  searching,
  onNavigate,
}: {
  query: string;
  hits: MessageSearchHit[] | null;
  searching: boolean;
  onNavigate: () => void;
}) {
  if (!query.trim()) {
    return (
      <div className={styles.center}>
        <p className={styles.muted}>모든 채팅방의 대화 내용에서 찾습니다.</p>
      </div>
    );
  }
  if (searching && hits === null) {
    return (
      <div className={styles.center} role="status">
        <p className={styles.muted}>검색 중…</p>
      </div>
    );
  }
  if (!hits || hits.length === 0) {
    return (
      <div className={styles.center} role="status">
        <p className={styles.muted}>일치하는 대화가 없습니다.</p>
      </div>
    );
  }
  return (
    <>
      <p className={styles.hitCount} role="status">
        대화 {hits.length}건
      </p>
      <ul className={styles.list}>
        {hits.map((hit) => (
          <li key={hit.messageId} className={styles.item}>
            <Link
              href={`/c/${hit.chatId}?m=${encodeURIComponent(hit.messageId)}`}
              className={styles.link}
              onClick={onNavigate}
            >
              <span className={styles.titleRow}>
                <span className={styles.title}>
                  <span className={styles.badge}>
                    {hit.role === 'user' ? '내 메시지' : '응답'}
                  </span>
                  {hit.chatTitle}
                </span>
                <time className={styles.time}>{formatDateTime(hit.createdAt)}</time>
              </span>
              <span className={styles.snippet}>
                {splitByTerms(hit.snippet, hit.matched).map((segment, i) =>
                  segment.match ? (
                    <mark key={i} className={styles.hl}>
                      {segment.text}
                    </mark>
                  ) : (
                    <span key={i}>{segment.text}</span>
                  ),
                )}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

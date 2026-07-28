/**
 * 홈 입력 드래프트와 "첫 메시지 핸드오프" 저장소.
 *
 * sessionStorage 를 쓰는 이유(명세의 hard navigation 요구가 출발점):
 *  - 라우터/리액트 상태는 hard navigation(전체 페이지 로드)에서 사라진다.
 *  - localStorage 는 탭 간에 공유돼 다른 탭의 드래프트가 새어 들어온다.
 *  - sessionStorage 는 "이 탭" 스코프로 새로고침/하드 내비게이션을 정확히 살아남는다.
 *
 * 핸드오프 계약(4단계와의 접점): 홈은 방을 만들고 pending 메시지를 남긴 뒤 이동만 한다.
 * "진입 시 입력한 내용으로 즉시 전송" 이라는 명세대로, 실제 전송 주체는 채팅방이다.
 * takePendingMessage 는 1회 소비(읽으면 지움)라 새로고침으로 중복 전송되지 않는다.
 */
const HOME_DRAFT_KEY = 'ai-chat/home-draft';
const PENDING_KEY = 'ai-chat/pending-message';

function storageOrNull(): Storage | null {
  return typeof window === 'undefined' ? null : window.sessionStorage;
}

export function readHomeDraft(): string {
  return storageOrNull()?.getItem(HOME_DRAFT_KEY) ?? '';
}

export function saveHomeDraft(value: string): void {
  const storage = storageOrNull();
  if (!storage) return;
  try {
    if (value) storage.setItem(HOME_DRAFT_KEY, value);
    else storage.removeItem(HOME_DRAFT_KEY);
  } catch {
    // 드래프트는 최선노력 저장이다 - 타이핑마다 불리므로 저장 실패(용량 초과)가
    // onChange 를 타고 올라와 입력 자체를 죽여선 안 된다.
  }
}

export function clearHomeDraft(): void {
  storageOrNull()?.removeItem(HOME_DRAFT_KEY);
}

/** 방별 입력 드래프트 키(STEP 11) - 홈 드래프트와 같은 규칙을 방 id 로 넓힌 것. */
const ROOM_DRAFT_PREFIX = 'ai-chat/room-draft/';

export function readRoomDraft(chatId: string): string {
  return storageOrNull()?.getItem(ROOM_DRAFT_PREFIX + chatId) ?? '';
}

export function saveRoomDraft(chatId: string, value: string): void {
  const storage = storageOrNull();
  if (!storage) return;
  try {
    if (value) storage.setItem(ROOM_DRAFT_PREFIX + chatId, value);
    else storage.removeItem(ROOM_DRAFT_PREFIX + chatId);
  } catch {
    // 홈 드래프트와 같은 최선노력 저장 - 저장 실패가 onChange 를 타고 입력을 죽여선 안 된다.
  }
}

export function clearRoomDraft(chatId: string): void {
  storageOrNull()?.removeItem(ROOM_DRAFT_PREFIX + chatId);
}

export function setPendingMessage(chatId: string, content: string): void {
  storageOrNull()?.setItem(PENDING_KEY, JSON.stringify({ chatId, content }));
}

/** 해당 방의 pending 메시지를 꺼내고 지운다(1회 소비). 없거나 다른 방 것이면 null. */
export function takePendingMessage(chatId: string): string | null {
  const storage = storageOrNull();
  if (!storage) return null;
  const rawValue = storage.getItem(PENDING_KEY);
  if (!rawValue) return null;
  try {
    const parsed = JSON.parse(rawValue) as { chatId?: string; content?: string };
    if (parsed.chatId !== chatId || typeof parsed.content !== 'string') return null;
    storage.removeItem(PENDING_KEY);
    return parsed.content;
  } catch {
    storage.removeItem(PENDING_KEY);
    return null;
  }
}

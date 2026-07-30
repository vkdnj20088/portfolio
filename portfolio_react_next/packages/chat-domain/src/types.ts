/**
 * 채팅 데이터 스키마.
 *
 * 서비스 개요가 예고한 확장 4가지를 스키마 수준에서 미리 수용한다.
 * "지금 구현"이 아니라 "나중에 타입/케이스 추가만으로 확장되는 모양"이 목표다.
 *
 *  1) 표·코드블럭·수식·이미지 렌더링  -> Message.parts 가 discriminated union 배열.
 *     유니온에 타입을 추가하면 렌더러 스위치만 늘어난다 - 'code'(STEP 12)로 실증했다.
 *  2) 받은 메시지만 있는 채팅방(알림톡형) -> ChatRoom.type = 'default' | 'receive-only'.
 *     mock 도 receive-only 방에는 전송을 거부해, 타입이 장식이 아니라 규칙임을 강제한다.
 *  3) Socket/SSE 스트리밍 전환 -> 응답이 단일 값이 아니라 ReplyEvent 스트림(AsyncIterable).
 *     기본 동작은 'done' 하나지만, 전송 계층이 'delta' 를 흘리기 시작해도 소비하는
 *     UI 코드는 바뀌지 않는다 - '/stream' 데모(STEP 12)가 같은 소비 코드로 시연한다.
 *  4) 모바일 웹뷰 -> 스키마 무관(뷰 계층 관심사).
 */

export type MessageRole = 'user' | 'assistant';

/** 메시지 본문 조각. 렌더링 확장은 이 유니온에 타입을 더하는 것으로 시작한다. */
export type MessagePart =
  | { type: 'text'; text: string }
  /** 코드 블럭(STEP 12) - 개요의 렌더링 확장 예고를 한 케이스 실증한 것. */
  | { type: 'code'; text: string; language?: string };

export interface Message {
  id: string;
  chatId: string;
  role: MessageRole;
  parts: MessagePart[];
  /** epoch ms. 표시 형식(YYYY-MM-DD HH:mm)은 표시 계층의 책임이다. */
  createdAt: number;
  /** 응답 피드백(STEP 11). 저장 데이터에 영속된다 - 없으면 평가하지 않은 것. */
  rating?: MessageRating;
}

/** 응답 피드백 값. null(해제)은 API 인자에서만 쓰고 저장 시에는 필드를 지운다. */
export type MessageRating = 'up' | 'down';

export type ChatRoomType = 'default' | 'receive-only';

export interface ChatRoom {
  id: string;
  title: string;
  type: ChatRoomType;
  createdAt: number;
  updatedAt: number;
}

/** 사이드바 목록용 - 방 정보에 "마지막 대화" 파생 값을 붙인다. */
export interface ChatRoomSummary extends ChatRoom {
  lastMessageAt: number | null;
  lastMessagePreview: string | null;
}

/**
 * 메시지 페이지(50개 단위). items 는 시간 오름차순.
 * nextBefore 가 null 이 아니면 더 오래된 메시지가 남아 있다 - 스크롤 최상단 도달 시
 * before=nextBefore 로 다시 호출한다(커서 기반이라 중간 삽입에도 밀림이 없다).
 */
export interface MessagePage {
  items: Message[];
  nextBefore: string | null;
}

/**
 * 대화 검색 결과 한 건(STEP 16).
 *
 * 방 목록 필터와 달리 "대화 내용"을 뒤지므로, 어느 방의 어느 메시지인지와 그 주변 발췌를 함께 준다.
 * 화면은 이 값만으로 결과 줄을 그리고, 클릭하면 messageId 로 그 메시지까지 데려간다.
 */
export interface MessageSearchHit {
  chatId: string;
  chatTitle: string;
  messageId: string;
  role: MessageRole;
  createdAt: number;
  /** 매칭 주변만 잘라낸 발췌(양끝이 잘렸으면 … 이 붙는다). */
  snippet: string;
  /** 발췌 안에서 실제로 매칭된 어휘 - 하이라이트용(조사가 붙은 원문에는 접두로 나타난다). */
  matched: string[];
  /** 관련도 점수(0~1). 동점이면 최신 메시지가 먼저 온다. */
  score: number;
}

/**
 * 응답 스트림 이벤트. 지금 mock 은 2초 뒤 'done' 하나만 내보낸다.
 * 추후 SSE/Socket 전환 시 'delta' 가 증분으로 흐르고 마지막에 'done' 이 온다 -
 * 소비 측은 for-await 루프 그대로다.
 */
export type ReplyEvent = { type: 'delta'; text: string } | { type: 'done'; message: Message };

export type ChatApiErrorCode =
  | 'NETWORK_OFFLINE'
  | 'NOT_FOUND'
  | 'INVALID_TITLE'
  | 'RECEIVE_ONLY'
  | 'REPLY_FAILED'
  | 'RATE_LIMITED'
  | 'STORAGE_FULL';

/**
 * 도메인 오류. UI 는 code 로 분기하고 message 는 로깅/디버깅용이다.
 *
 * `RATE_LIMITED` 만 {@link retryAfterSeconds} 를 함께 들고 온다. 이 값을 오류에 실어 두는 이유는
 * "재시도 가능한 실패"와 "영구 실패"가 UI 에서 다른 것이어야 하기 때문이다 - 언제 다시 되는지
 * 아는 실패는 사용자가 기다리면 되고, 모르는 실패는 사용자가 할 수 있는 게 없다.
 * 나머지 코드에서는 undefined 다(있는 척하지 않는다).
 */
export class ChatApiError extends Error {
  constructor(
    public readonly code: ChatApiErrorCode,
    message: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ChatApiError';
  }
}

/** 메시지의 텍스트 표현 - 목록 미리보기 등. 텍스트가 아닌 part 는 건너뛴다. */
export function messageText(message: Message): string {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join(' ');
}

/**
 * 첫 메시지에서 방 제목을 파생한다(공백 접기 + 30자 자름).
 * 코드포인트 단위로 잘라 이모지 등 서로게이트 쌍이 깨지지 않게 한다.
 */
export function deriveRoomTitle(content: string, max = 30): string {
  const collapsed = content.trim().replace(/\s+/g, ' ');
  const chars = [...collapsed];
  if (chars.length <= max) return collapsed;
  return `${chars.slice(0, max).join('')}…`;
}

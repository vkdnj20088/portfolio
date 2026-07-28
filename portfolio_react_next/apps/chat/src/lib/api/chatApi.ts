import { ChatApiError, createMockChatApi, type ChatApi } from '@chat/chat-domain';
import { reportRequestOutcome } from '@/lib/network/networkQuality';
import { sseStreamReply } from './sseTransport';

/**
 * 네트워크 품질 관측에서 "나쁜 요청"으로 셀 실패인지 판별한다.
 *
 * NOT_FOUND(삭제된 방 URL 방문), REPLY_FAILED(/error 데모) 같은 도메인 거절은
 * 요청이 정상 왕복한 결과다 - HTTP 로 치면 4xx/5xx 응답이지 회선 문제가 아니다.
 * 이를 나쁨으로 세면 "/error 데모 두 번"만으로 네트워크 배너가 오점등해
 * 서로 다른 데모(응답 실패/네트워크 상태)가 간섭한다. 전송 계층 실패
 * (NETWORK_OFFLINE)와 정체불명 예외만 나쁜 관측으로 센다.
 */
export function isTransportFailure(error: unknown): boolean {
  return !(error instanceof ChatApiError) || error.code === 'NETWORK_OFFLINE';
}

/**
 * 앱 전역에서 쓰는 채팅 API 싱글턴.
 *
 * 도메인 mock 을 그대로 노출하지 않고 한 겹 감싸는 이유:
 *  - 모든 요청의 결과(성공/실패/소요시간)를 네트워크 품질 스토어에 보고한다.
 *    STEP 1 의 online|unstable|offline 배너가 이 관측으로 완성된다.
 *  - 추후 mock -> 실서버 전환 시 이 파일만 바꾸면 된다(화면 코드는 chatApi 인터페이스만 안다).
 */
const raw = createMockChatApi();

/**
 * 전송 계층 선택(STEP 12 실증). 기본은 in-process mock, NEXT_PUBLIC_TRANSPORT=sse 면
 * 실제 SSE(route handler /api/reply)로 응답을 받는다. 소비 코드는 어느 쪽이든 동일하다.
 */
const useSseTransport = process.env.NEXT_PUBLIC_TRANSPORT === 'sse';

function tracked<Args extends unknown[], R>(
  fn: (...args: Args) => Promise<R>,
): (...args: Args) => Promise<R> {
  return async (...args) => {
    const startedAt = Date.now();
    try {
      const result = await fn(...args);
      reportRequestOutcome({ durationMs: Date.now() - startedAt, ok: true });
      return result;
    } catch (error) {
      reportRequestOutcome({ durationMs: Date.now() - startedAt, ok: !isTransportFailure(error) });
      throw error;
    }
  };
}

export const chatApi: ChatApi = {
  listChatRooms: tracked(raw.listChatRooms),
  getChatRoom: tracked(raw.getChatRoom),
  createChatRoom: tracked(raw.createChatRoom),
  deleteChatRoom: tracked(raw.deleteChatRoom),
  renameChatRoom: tracked(raw.renameChatRoom),
  listMessages: tracked(raw.listMessages),
  sendMessage: tracked(raw.sendMessage),
  rateMessage: tracked(raw.rateMessage),
  deleteMessage: tracked(raw.deleteMessage),
  // 대화 검색(STEP 16)도 한 번의 요청이라 그대로 계측한다 - 서버 검색으로 옮겨도 이 줄은 그대로다.
  searchMessages: tracked(raw.searchMessages),
  // 스트림은 시작~완료가 "한 요청" 이 아니므로 여기서 계측하지 않는다.
  // 소비하는 쪽(채팅방, STEP 4)이 완료/실패 시점에 보고한다.
  // 중단용 AbortSignal(STEP 11)은 그대로 통과시킨다.
  // 전송 계층만 플래그로 갈아끼운다 - 소비 코드(ChatRoom/MessageList)는 불변이다(STEP 12).
  streamReply: useSseTransport
    ? (chatId, options) => sseStreamReply(raw, chatId, options)
    : (chatId, options) => raw.streamReply(chatId, options),
  // SSE 전송이 상태(일련번호/영속)를 재사용하기 위한 원시. 전송을 안 써도 계약상 노출한다.
  getReplySeq: (chatId) => raw.getReplySeq(chatId),
  appendAssistantReply: (chatId, text) => raw.appendAssistantReply(chatId, text),
  // 캐시 무효화는 요청이 아니라서 계측 대상이 아니다(다중 탭 동기화용).
  invalidateCache: () => raw.invalidateCache(),
};

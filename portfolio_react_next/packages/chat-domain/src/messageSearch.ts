// 배럴(@chat/search-domain)이 아니라 엔진 전용 진입점에서 가져온다. 배럴은 사내문서 코퍼스와
// 그 색인을 모듈 로드 시 굽는 부수효과를 함께 끌고 와, 이 앱 번들에 쓰지도 않는 문서 더미가 실린다
// (실제로 챗 번들에서 코퍼스 문장이 발견돼 되돌린 자리다).
import { createIndex, type TextIndex } from '@chat/search-domain/textIndex';
import type { ChatRoom, Message, MessageSearchHit } from './types';

/**
 * 대화 전문 검색(STEP 16).
 *
 * 사이드바의 기존 검색은 방 제목·미리보기 부분일치였고, 메시지 본문 검색은 "서버 검색과 함께 설계할
 * 자리"로 미뤄 두었던 곳이다. 그 자리를 다른 데모(JC DocuQA)에서 만든 검색 엔진(@chat/search-domain)을
 * 그대로 물려 채운다. 엔진이 인스턴스 팩토리라 문서 집합만 바꿔 끼우면 된다.
 *
 * 문서 검색과 같은 엔진이지만 값을 하는 부품은 다르다: 대화는 사용자가 쓴 말 그대로라 동의어 확장이
 * 걸릴 일이 드물고, 실제로 효과를 내는 건 (1) 조사·어미 정규화("커버리지를"로 저장돼도 "커버리지"로
 * 찾힘) (2) TF-IDF 랭킹(흔한 말 대신 희소어가 상위) (3) 발췌 하이라이트다. 그래서 UI 도 "시맨틱
 * 검색"이 아니라 "대화 검색"이라 부른다 - 같은 엔진이어도 데이터가 다르면 파는 값이 다르다.
 */

/** 검색 대상 상태(저장소 형태 그대로 - 방과 방별 메시지). */
export interface SearchableChatState {
  rooms: ChatRoom[];
  messages: Record<string, Message[]>;
}

/**
 * 색인용 텍스트. 미리보기용 messageText 와 달리 코드 조각까지 포함한다 -
 * "interface Retrospective" 처럼 코드 블럭 안의 말도 검색으로 찾을 수 있어야 한다.
 */
function indexableText(message: Message): string {
  return message.parts.map((part) => part.text).join('\n');
}

/** 스니펫 앞뒤 여유(문자). 결과 줄 한 줄에 들어가는 정도. */
const SNIPPET_RADIUS = 34;

/**
 * 매칭 어휘 주변만 잘라낸 발췌를 만든다. 매칭이 본문 뒤쪽에 있으면 앞을 잘라내야 결과 줄에서
 * 실제로 걸린 부분이 보인다(앞 40자만 자르면 정작 매칭이 화면 밖으로 나간다).
 * 매칭 어휘는 정규화된 어간이라 원문에는 조사가 붙은 형태로 나타난다 - 접두 일치로 찾는다.
 */
export function buildSnippet(text: string, matched: string[], radius = SNIPPET_RADIUS): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const lower = flat.toLowerCase();
  let at = -1;
  for (const term of matched) {
    const found = lower.indexOf(term.toLowerCase());
    if (found !== -1 && (at === -1 || found < at)) at = found;
  }
  if (at === -1 || flat.length <= radius * 3) return flat;
  const start = Math.max(0, at - radius);
  const end = Math.min(flat.length, at + radius * 2);
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`;
}

export interface MessageSearcher {
  /** 저장소가 바뀌면 색인을 버린다(다음 검색에서 다시 굽는다). */
  invalidate(): void;
  search(state: SearchableChatState, query: string, limit?: number): MessageSearchHit[];
}

/**
 * 검색기. 색인은 메시지가 바뀔 때만 다시 굽는다 - 매 타이핑마다 전체를 재색인하면 방이 커질수록
 * 입력이 느려진다. 무효화 지점은 저장(persist)과 캐시 폐기 한 곳씩이라 놓치기 어렵다.
 */
export function createMessageSearcher(): MessageSearcher {
  let cache: { index: TextIndex; byId: Map<string, { message: Message; room: ChatRoom }> } | null =
    null;

  function build(state: SearchableChatState) {
    const byId = new Map<string, { message: Message; room: ChatRoom }>();
    const docs: { id: string; text: string }[] = [];
    for (const room of state.rooms) {
      for (const message of state.messages[room.id] ?? []) {
        byId.set(message.id, { message, room });
        docs.push({ id: message.id, text: indexableText(message) });
      }
    }
    cache = { index: createIndex(docs), byId };
    return cache;
  }

  return {
    invalidate() {
      cache = null;
    },

    search(state, query, limit = 20): MessageSearchHit[] {
      const trimmed = query.trim();
      if (!trimmed) return [];
      const { index, byId } = cache ?? build(state);
      // 엔진은 점수 순으로만 자르므로, 동점이 흔한 대화(같은 문구 반복)에서 최신 것을 고르려면
      // 넉넉히 받아서 다시 정렬해야 한다. 점수 우선, 같으면 최신 - 채팅에서는 최신이 곧 관련성이다.
      const window = Math.max(limit * 4, 40);
      const hits = index.search(trimmed, 'semantic', window);
      const rows: MessageSearchHit[] = [];
      for (const hit of hits) {
        const found = byId.get(hit.id);
        if (!found) continue;
        rows.push({
          chatId: found.room.id,
          chatTitle: found.room.title,
          messageId: found.message.id,
          role: found.message.role,
          createdAt: found.message.createdAt,
          snippet: buildSnippet(indexableText(found.message), hit.matched),
          matched: hit.matched,
          score: hit.semantic,
        });
      }
      return rows
        .sort(
          (a, b) =>
            b.score - a.score ||
            b.createdAt - a.createdAt ||
            a.messageId.localeCompare(b.messageId),
        )
        .slice(0, limit);
    },
  };
}

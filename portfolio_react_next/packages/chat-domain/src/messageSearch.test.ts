import { describe, it, expect } from 'vitest';
import { createMockChatApi } from './mockChatApi';
import { buildSnippet } from './messageSearch';
import { createMemoryStorage } from './storage';

/**
 * 대화 전문 검색(STEP 16). 방 목록 필터가 못 하던 것 - 본문에서 찾기, 관련도 랭킹, 발췌 - 를 고정한다.
 * 색인 무효화도 함께 본다: 새 메시지가 검색에 안 잡히면 "검색이 오래된 결과를 준다"는 최악의 버그가 된다.
 */
function api() {
  return createMockChatApi({
    storage: createMemoryStorage(),
    isOnline: () => true,
    now: () => 1_700_000_000_000,
    delays: { read: 0, write: 0, reply: 0 },
  });
}

describe('searchMessages', () => {
  it('메시지 본문에서 찾는다(방 제목 필터로는 못 찾던 것)', async () => {
    const chat = api();
    const hits = await chat.searchMessages('액션 아이템');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.snippet).toContain('액션');
    // 결과는 어느 방의 어느 메시지인지 스스로 안다 - 화면이 그 메시지로 데려갈 수 있어야 하므로.
    expect(hits[0]!.chatId.length).toBeGreaterThan(0);
    expect(hits[0]!.messageId.length).toBeGreaterThan(0);
    expect(hits[0]!.chatTitle.length).toBeGreaterThan(0);
  });

  it('조사가 붙어 저장된 말도 맨 명사로 찾는다', async () => {
    const chat = api();
    // 시드 본문은 "회고에서 나온 액션에", "회고를" 처럼 조사가 붙어 있다.
    const hits = await chat.searchMessages('회고');
    expect(hits.length).toBeGreaterThan(0);
  });

  it('빈 질의는 빈 결과(불필요한 색인·렌더를 만들지 않는다)', async () => {
    const chat = api();
    expect(await chat.searchMessages('   ')).toEqual([]);
  });

  it('코퍼스에 없는 말은 빈 결과', async () => {
    const chat = api();
    expect(await chat.searchMessages('zzzz9999xkcd')).toEqual([]);
  });

  it('동점이면 최신 메시지가 먼저 온다(채팅에서는 최신이 곧 관련성)', async () => {
    const chat = api();
    // 긴 방의 130개 메시지는 같은 문구를 반복해 점수가 동점이 된다.
    const hits = await chat.searchMessages('페이지네이션', { limit: 5 });
    expect(hits.length).toBe(5);
    for (let i = 1; i < hits.length; i++) {
      const prev = hits[i - 1]!;
      const cur = hits[i]!;
      if (prev.score === cur.score) expect(prev.createdAt).toBeGreaterThanOrEqual(cur.createdAt);
    }
  });

  it('새로 보낸 메시지가 곧바로 검색된다(색인 무효화)', async () => {
    const chat = api();
    const rooms = await chat.listChatRooms();
    const room = rooms[0]!;
    const unique = '고유토큰딸기수박';
    expect(await chat.searchMessages(unique)).toEqual([]);
    await chat.sendMessage(room.id, `${unique} 를 포함한 메시지`);
    const hits = await chat.searchMessages(unique);
    expect(hits.length).toBe(1);
    expect(hits[0]!.chatId).toBe(room.id);
  });

  it('삭제한 방의 메시지는 더 이상 검색되지 않는다', async () => {
    const chat = api();
    const rooms = await chat.listChatRooms();
    const target = rooms.find((r) => r.title.includes('긴 대화'))!;
    expect((await chat.searchMessages('페이지네이션')).length).toBeGreaterThan(0);
    await chat.deleteChatRoom(target.id);
    const after = await chat.searchMessages('페이지네이션');
    expect(after.every((h) => h.chatId !== target.id)).toBe(true);
  });

  it('코드 블럭 안의 말도 찾는다(미리보기 텍스트에는 없는 부분)', async () => {
    const chat = api();
    const hits = await chat.searchMessages('Retrospective');
    expect(hits.length).toBeGreaterThan(0);
  });
});

describe('buildSnippet', () => {
  it('매칭이 뒤쪽에 있으면 앞을 잘라 매칭이 보이게 한다', () => {
    const text = `${'앞부분 채우기 '.repeat(12)}핵심어 그리고 뒷말`;
    const snippet = buildSnippet(text, ['핵심어']);
    expect(snippet).toContain('핵심어');
    expect(snippet.startsWith('…')).toBe(true);
  });

  it('짧은 본문은 자르지 않는다', () => {
    expect(buildSnippet('짧은 본문입니다', ['본문'])).toBe('짧은 본문입니다');
  });

  it('매칭을 못 찾으면 공백만 정리해 그대로 준다', () => {
    expect(buildSnippet('여러  공백\n줄바꿈', [])).toBe('여러 공백 줄바꿈');
  });
});

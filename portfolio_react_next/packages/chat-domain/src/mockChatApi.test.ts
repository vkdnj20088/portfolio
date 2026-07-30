import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockChatApi, pickReply } from './mockChatApi';
import { createMemoryStorage, type KVStorage } from './storage';
import { ChatApiError, deriveRoomTitle, messageText, type ReplyEvent } from './types';

/**
 * mock 을 브라우저 없이 검증한다 - storage/isOnline/now 를 주입하는 이유가 이 파일이다.
 * 읽기/쓰기 지연은 0으로 줄여 빠르게 돌리고, 응답 2000ms 는 명세값이므로
 * 가짜 타이머로 "정확히 2초 뒤"까지 검증한다.
 */
function createApi(overrides: Parameters<typeof createMockChatApi>[0] = {}) {
  let tick = 1_700_000_000_000;
  return createMockChatApi({
    storage: createMemoryStorage(),
    isOnline: () => true,
    now: () => tick++, // 호출마다 1ms 증가 - 정렬이 결정적이다
    delays: { read: 0, write: 0, reply: 0 },
    seed: false,
    ...overrides,
  });
}

async function collect(iter: AsyncGenerator<ReplyEvent>): Promise<ReplyEvent[]> {
  const out: ReplyEvent[] = [];
  for await (const event of iter) out.push(event);
  return out;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('채팅방 CRUD', () => {
  it('생성한 방이 목록에 요약 정보와 함께 나타난다', async () => {
    const api = createApi();
    const room = await api.createChatRoom({ title: '  첫 방  ' });

    expect(room.title).toBe('첫 방'); // trim
    const list = await api.listChatRooms();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: room.id, lastMessageAt: null, lastMessagePreview: null });
  });

  it('목록은 마지막 대화 시간 내림차순이다 - 오래된 방에 메시지가 오면 맨 위로 온다', async () => {
    const api = createApi();
    const older = await api.createChatRoom({ title: '먼저 만든 방' });
    const newer = await api.createChatRoom({ title: '나중에 만든 방' });

    expect((await api.listChatRooms()).map((r) => r.id)).toEqual([newer.id, older.id]);

    await api.sendMessage(older.id, '이 방이 다시 활발해졌다');
    const after = await api.listChatRooms();
    expect(after.map((r) => r.id)).toEqual([older.id, newer.id]);
    expect(after[0]?.lastMessagePreview).toBe('이 방이 다시 활발해졌다');
  });

  it('제목 수정: 반영되고, 빈 제목은 INVALID_TITLE 로 거부된다', async () => {
    const api = createApi();
    const room = await api.createChatRoom({ title: '원래 제목' });

    await api.renameChatRoom(room.id, '바꾼 제목');
    expect((await api.getChatRoom(room.id)).title).toBe('바꾼 제목');

    await expect(api.renameChatRoom(room.id, '   ')).rejects.toMatchObject({
      code: 'INVALID_TITLE',
    });
  });

  it('삭제하면 방 조회가 NOT_FOUND 로 실패하고 목록에서도 사라진다', async () => {
    const api = createApi();
    const room = await api.createChatRoom({ title: '지울 방' });
    await api.sendMessage(room.id, '메시지도 있었다');

    await api.deleteChatRoom(room.id);

    expect(await api.listChatRooms()).toHaveLength(0);
    await expect(api.getChatRoom(room.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('메시지 페이지네이션 (50개 단위)', () => {
  it('130개는 50/50/30 세 페이지로 나뉘고, 이어 붙이면 순서·중복 없이 전체가 된다', async () => {
    const api = createApi();
    const room = await api.createChatRoom({ title: '긴 방' });
    for (let i = 1; i <= 130; i++) await api.sendMessage(room.id, `m${i}`);

    const page1 = await api.listMessages({ chatId: room.id });
    expect(page1.items).toHaveLength(50);
    expect(page1.nextBefore).not.toBeNull();

    const page2 = await api.listMessages({ chatId: room.id, before: page1.nextBefore! });
    expect(page2.items).toHaveLength(50);

    const page3 = await api.listMessages({ chatId: room.id, before: page2.nextBefore! });
    expect(page3.items).toHaveLength(30);
    expect(page3.nextBefore).toBeNull(); // 더 오래된 페이지 없음

    const stitched = [...page3.items, ...page2.items, ...page1.items];
    expect(stitched).toHaveLength(130);
    expect(new Set(stitched.map((m) => m.id)).size).toBe(130); // 중복 없음
    for (let i = 1; i < stitched.length; i++) {
      expect(stitched[i]!.createdAt).toBeGreaterThanOrEqual(stitched[i - 1]!.createdAt); // 오름차순
    }
  });

  it('경계 메시지를 다른 탭이 삭제해도 loadOlder 가 죽지 않는다(삭제 견디는 커서)', async () => {
    const api = createApi();
    const room = await api.createChatRoom({ title: '삭제 견딤' });
    for (let i = 1; i <= 130; i++) await api.sendMessage(room.id, `m${i}`);

    const page1 = await api.listMessages({ chatId: room.id });
    const cursor = page1.nextBefore!;
    // 커서가 가리키는 경계 메시지(page1 의 가장 오래된 항목)를 삭제한다 - 다른 탭의 삭제 시뮬레이션.
    const boundary = page1.items[0]!;
    await api.deleteMessage(room.id, boundary.id);

    // id 커서였다면 여기서 NOT_FOUND 로 영구 실패했다. 합성 커서는 시간 위치로 이어 간다.
    const page2 = await api.listMessages({ chatId: room.id, before: cursor });
    expect(page2.items.length).toBeGreaterThan(0);
    expect(page2.items.some((m) => m.id === boundary.id)).toBe(false); // 삭제된 경계는 없음
    expect(page2.items.every((m) => m.createdAt < boundary.createdAt)).toBe(true); // 순서 유지
  });

  it('잘못된 형식의 커서는 NOT_FOUND 로 거절한다(정상 커서는 삭제돼도 통과하는 것과 구분)', async () => {
    const api = createApi();
    const room = await api.createChatRoom({ title: '커서 검증' });
    await api.sendMessage(room.id, '하나');
    await expect(
      api.listMessages({ chatId: room.id, before: 'not-a-valid-cursor' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('메시지 전송과 응답', () => {
  it('receive-only 방은 전송을 거부한다 - 방 유형이 장식이 아니라 규칙이다', async () => {
    const api = createApi();
    const room = await api.createChatRoom({ title: '알림방', type: 'receive-only' });
    await expect(api.sendMessage(room.id, '보내질까?')).rejects.toMatchObject({
      code: 'RECEIVE_ONLY',
    });
  });

  it('응답은 정확히 2000ms 뒤에 done 이벤트로 도착하고 영속된다', async () => {
    const api = createApi({ delays: { read: 0, write: 0, reply: 2000 } });
    const room = await api.createChatRoom({ title: '응답 테스트' });
    await api.sendMessage(room.id, '안녕하세요');

    // 가짜 타이머는 검증 대상(2000ms 응답)에만 건다. 셋업 호출까지 가짜 시계에 묶으면
    // 지연 0ms 의 setTimeout 도 진행되지 않아 준비 단계가 영원히 대기한다.
    vi.useFakeTimers();
    let settled = false;
    const pending = collect(api.streamReply(room.id)).then((events) => {
      settled = true;
      return events;
    });

    await vi.advanceTimersByTimeAsync(1999);
    expect(settled).toBe(false); // 2초 전에는 오지 않는다

    await vi.advanceTimersByTimeAsync(1);
    const events = await pending;
    vi.useRealTimers(); // 이후의 listMessages(지연 0ms)가 실제 시계로 돌게 복원

    expect(events).toHaveLength(1);
    const done = events[0]!;
    expect(done.type).toBe('done');
    if (done.type === 'done') {
      expect(done.message.role).toBe('assistant');
    }

    const page = await api.listMessages({ chatId: room.id });
    expect(page.items[page.items.length - 1]?.role).toBe('assistant'); // 영속 확인
  });

  it('응답 대기 중 중단(AbortSignal)하면 응답이 생성되지도 영속되지도 않는다', async () => {
    const api = createApi({ delays: { read: 0, write: 0, reply: 2000 } });
    const room = await api.createChatRoom({ title: '중단 테스트' });
    await api.sendMessage(room.id, '질문 하나');

    vi.useFakeTimers();
    const controller = new AbortController();
    const pending = collect(api.streamReply(room.id, { signal: controller.signal }));

    await vi.advanceTimersByTimeAsync(1000); // 대기 한가운데서
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    vi.useRealTimers();

    const page = await api.listMessages({ chatId: room.id });
    expect(page.items).toHaveLength(1); // 사용자 메시지뿐 - 중단은 흔적을 남기지 않는다
    expect(page.items[0]?.role).toBe('user');
  });

  it("'/stream' 트리거는 delta 로 증분 전송하고 완결(done) 시점에만 영속한다", async () => {
    const api = createApi();
    const room = await api.createChatRoom({ title: '스트림 데모' });
    await api.sendMessage(room.id, '/stream 흐름을 보여줘');

    const events = await collect(api.streamReply(room.id));
    const deltas = events.filter((e) => e.type === 'delta');
    const done = events[events.length - 1]!;

    expect(deltas.length).toBeGreaterThan(1); // 완성본 한 번이 아니라 증분이다
    expect(done.type).toBe('done');
    if (done.type === 'done') {
      const stitched = deltas.map((e) => (e.type === 'delta' ? e.text : '')).join('');
      expect(stitched).toBe(messageText(done.message)); // 증분의 합 = 완성본
    }
    const page = await api.listMessages({ chatId: room.id });
    expect(page.items[page.items.length - 1]?.role).toBe('assistant'); // 완결 후 영속
  });

  it('피드백은 영속되고, null 로 해제하면 필드가 사라진다', async () => {
    const storage = createMemoryStorage();
    const api = createApi({ storage });
    const room = await api.createChatRoom({ title: '피드백 테스트' });
    const message = await api.sendMessage(room.id, '평가할 메시지');

    const rated = await api.rateMessage(room.id, message.id, 'up');
    expect(rated.rating).toBe('up');

    // 같은 storage 를 읽는 새 인스턴스 = 새로고침. 평가가 데이터로 남아 있어야 한다.
    const reloaded = createApi({ storage });
    const page = await reloaded.listMessages({ chatId: room.id });
    expect(page.items[0]?.rating).toBe('up');

    const cleared = await reloaded.rateMessage(room.id, message.id, null);
    expect(cleared.rating).toBeUndefined();
  });

  it('메시지를 삭제하면 목록과 저장소에서 함께 사라진다(재생성의 재료)', async () => {
    const storage = createMemoryStorage();
    const api = createApi({ storage });
    const room = await api.createChatRoom({ title: '삭제 테스트' });
    await api.sendMessage(room.id, '남을 메시지');
    const target = await api.sendMessage(room.id, '지울 메시지');

    await api.deleteMessage(room.id, target.id);

    const page = await createApi({ storage }).listMessages({ chatId: room.id });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.id).not.toBe(target.id);

    await expect(api.deleteMessage(room.id, target.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('"/error" 가 포함된 메시지에 대한 응답은 REPLY_FAILED 로 실패한다(결정적 트리거)', async () => {
    const api = createApi();
    const room = await api.createChatRoom({ title: '에러 데모' });
    await api.sendMessage(room.id, '이번엔 /error 를 재현해줘');

    await expect(collect(api.streamReply(room.id))).rejects.toMatchObject({
      code: 'REPLY_FAILED',
    });
  });
});

describe('네트워크/영속', () => {
  it('오프라인이면 NETWORK_OFFLINE 으로 실패한다', async () => {
    const api = createApi({ isOnline: () => false });
    await expect(api.listChatRooms()).rejects.toMatchObject({ code: 'NETWORK_OFFLINE' });
  });

  it('저장 값이 손상돼 있으면 죽지 않고 시드로 복구한다', async () => {
    const storage = createMemoryStorage();
    storage.set('ai-chat/v1', '{이건 JSON 이 아니다');

    const api = createMockChatApi({
      storage,
      isOnline: () => true,
      delays: { read: 0, write: 0, reply: 0 },
      // seed 기본값(true): 손상 데이터를 버리고 시드로 재구성돼야 한다
    });

    const rooms = await api.listChatRooms(); // 가드가 없으면 여기서 parse 예외로 영구 실패한다
    expect(rooms.length).toBeGreaterThanOrEqual(2);
    expect(storage.get('ai-chat/v1')).not.toBe('{이건 JSON 이 아니다'); // 정상 상태로 재영속
  });

  it('형태가 틀린 저장 값(유효한 JSON)도 죽지 않고 시드로 복구한다', async () => {
    const storage = createMemoryStorage();
    // JSON.parse 는 통과하지만 ChatState 형태가 아니다 - 파싱 가드의 사각지대
    storage.set('ai-chat/v1', JSON.stringify({ rooms: 5 }));

    const api = createMockChatApi({
      storage,
      isOnline: () => true,
      delays: { read: 0, write: 0, reply: 0 },
    });

    const rooms = await api.listChatRooms(); // 형태 가드가 없으면 rooms.map 에서 죽는다
    expect(rooms.length).toBeGreaterThanOrEqual(2);
  });

  it('저장 실패(용량 초과) 시 STORAGE_FULL 로 전파하고 유령 데이터를 남기지 않는다', async () => {
    const inner = createMemoryStorage();
    let full = false;
    const storage: KVStorage = {
      get: (key) => inner.get(key),
      set: (key, value) => {
        if (full) throw new Error('QuotaExceededError');
        inner.set(key, value);
      },
    };
    const api = createApi({ storage });
    const room = await api.createChatRoom({ title: '용량 한계 테스트' });

    full = true;
    await expect(api.sendMessage(room.id, '저장되지 못할 메시지')).rejects.toMatchObject({
      code: 'STORAGE_FULL',
    });

    full = false;
    // 실패 시 메모리 캐시를 버렸으므로 다음 조회는 저장소 기준이다 -
    // "조회는 되는데 새로고침하면 사라지는" 유령 메시지가 존재할 수 없다
    const page = await api.listMessages({ chatId: room.id });
    expect(page.items).toHaveLength(0);
  });

  it('제목 수정의 쓰기 지연 중 invalidateCache 가 끼어들어도 수정이 유실되지 않는다', async () => {
    const api = createApi();
    const room = await api.createChatRoom({ title: '경합 전 제목' });

    // 쓰기가 지연(await)에 양보한 사이 다른 탭의 storage 이벤트가 캐시를 버리는
    // 시나리오. 변이 대상을 지연 전에 잡아 두면 버려진 상태를 고쳐서 유실된다.
    const renaming = api.renameChatRoom(room.id, '경합 후 제목');
    api.invalidateCache();
    await renaming;

    expect((await api.getChatRoom(room.id)).title).toBe('경합 후 제목');
  });

  it('다른 탭의 수정은 invalidateCache 후에야 보인다(다중 탭 시나리오)', async () => {
    const storage = createMemoryStorage();
    const api = createApi({ storage });
    const room = await api.createChatRoom({ title: '원래 제목' });

    // "다른 탭"의 수정 재현: 이 인스턴스를 거치지 않고 저장소를 직접 바꾼다
    const raw = JSON.parse(storage.get('ai-chat/v1')!) as {
      rooms: Array<{ id: string; title: string }>;
    };
    raw.rooms[0]!.title = '다른 탭이 바꾼 제목';
    storage.set('ai-chat/v1', JSON.stringify(raw));

    // 메모리 캐시 때문에 아직 이전 값이 보인다 - 이것이 storage 이벤트만으로
    // 동기화가 안 되는 이유다
    expect((await api.getChatRoom(room.id)).title).toBe('원래 제목');

    api.invalidateCache();
    expect((await api.getChatRoom(room.id)).title).toBe('다른 탭이 바꾼 제목');
  });

  it('같은 storage 를 쓰는 새 인스턴스가 이전 상태를 그대로 읽는다(새로고침 시나리오)', async () => {
    const storage = createMemoryStorage();
    const first = createApi({ storage });
    const room = await first.createChatRoom({ title: '영속 확인' });
    await first.sendMessage(room.id, '남아 있어야 한다');

    const second = createApi({ storage }); // 새로고침 = 새 인스턴스, 같은 저장소
    const list = await second.listChatRooms();
    expect(list[0]?.lastMessagePreview).toBe('남아 있어야 한다');
  });

  it('시드는 페이지네이션 데모용 130개짜리 방을 포함한다', async () => {
    const api = createMockChatApi({
      storage: createMemoryStorage(),
      isOnline: () => true,
      delays: { read: 0, write: 0, reply: 0 },
      // seed 기본값(true) 사용
    });
    const rooms = await api.listChatRooms();
    expect(rooms.length).toBeGreaterThanOrEqual(2);

    const long = rooms.find((r) => r.title.includes('페이지네이션'));
    expect(long).toBeDefined();
    const page1 = await api.listMessages({ chatId: long!.id });
    expect(page1.items).toHaveLength(50);
    expect(page1.nextBefore).not.toBeNull();
  });
});

describe('도메인 유틸', () => {
  it('deriveRoomTitle: 공백을 접고 30자(코드포인트)에서 자른다', () => {
    expect(deriveRoomTitle('  안녕   하세요  ')).toBe('안녕 하세요');
    const long = '가'.repeat(40);
    const derived = deriveRoomTitle(long);
    expect([...derived]).toHaveLength(31); // 30자 + …
    expect(derived.endsWith('…')).toBe(true);
  });

  it('code part 는 요약 텍스트(messageText)에 섞이지 않는다 - 미리보기/제목 파생 보호', () => {
    expect(
      messageText({
        id: 'm',
        chatId: 'c',
        role: 'assistant',
        parts: [
          { type: 'text', text: '설명입니다' },
          { type: 'code', text: 'const a = 1;' },
        ],
        createdAt: 0,
      }),
    ).toBe('설명입니다');
  });

  it('ChatApiError 는 code 로 분기 가능하다', () => {
    const err = new ChatApiError('NOT_FOUND', '없음');
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('NOT_FOUND');
  });
});

describe('응답 문안 선택 (STEP 15)', () => {
  it('키워드가 있으면 주제 문안이 온다 - 조사가 붙어도 어간 포함으로 걸린다', () => {
    // 같은 주제(조사만 다름) + 같은 일련번호 = 같은 문안. 키워드가 없으면 다른 풀이다.
    expect(pickReply('테스트를 어떻게 짜야 할까?', 0)).toBe(pickReply('테스트 코드가 고민이야', 0));
    expect(pickReply('테스트를 어떻게 짜야 할까?', 0)).not.toBe(
      pickReply('오늘 점심 뭐 먹을까요', 0),
    );
  });

  it('같은 주제 안에서 일련번호로 순환한다 - 연속 중복이 구조적으로 없다', () => {
    const four = [0, 1, 2, 3].map((seq) => pickReply('테스트', seq));
    expect(new Set(four).size).toBe(4); // 4문안이 전부 서로 다르게 순회된다
    expect(pickReply('테스트', 4)).toBe(four[0]!); // 한 바퀴 돌면 처음으로
  });

  it('키워드가 겹치면 테이블 앞 주제가 이긴다 - "에러 상태"는 에러 주제다', () => {
    expect(pickReply('에러 상태 관리가 고민이에요', 1)).toBe(pickReply('에러 처리 알려줘', 1));
  });

  it('키워드가 없으면 일반 문안을 같은 규칙으로 순환한다', () => {
    const all = Array.from({ length: 16 }, (_, seq) => pickReply('오늘 점심 뭐 먹을까요', seq));
    expect(new Set(all).size).toBe(16);
    expect(pickReply('오늘 점심 뭐 먹을까요', 16)).toBe(all[0]!);
  });

  it('응답은 마지막 사용자 메시지를 읽는다 - 주제 문안이 실제 응답으로 온다', async () => {
    const api = createApi();
    const room = await api.createChatRoom({ title: '주제 응답' });
    const question = '테스트 커버리지는 어디까지 챙겨야 할까?';
    await api.sendMessage(room.id, question);

    const events = await collect(api.streamReply(room.id));
    const done = events[events.length - 1]!;
    expect(done.type).toBe('done');
    if (done.type === 'done') {
      expect(messageText(done.message)).toBe(pickReply(question, 0));
    }
  });

  it('재생성은 같은 질문에 다른 문안을 준다 - 일련번호가 삭제와 무관하게 전진한다', async () => {
    const api = createApi();
    const room = await api.createChatRoom({ title: '재생성' });
    const question = '이 버그는 재현이 안 되는데 어떻게 디버깅하지?';
    await api.sendMessage(room.id, question);

    const first = (await collect(api.streamReply(room.id)))[0]!;
    if (first.type !== 'done') throw new Error('done 이벤트가 아니다');
    await api.deleteMessage(room.id, first.message.id);
    const second = (await collect(api.streamReply(room.id)))[0]!;
    if (second.type !== 'done') throw new Error('done 이벤트가 아니다');

    expect(messageText(second.message)).not.toBe(messageText(first.message));
    expect(messageText(second.message)).toBe(pickReply(question, 1)); // 같은 주제의 다음 문안
  });
});

describe('SSE 전송 지원 원시 (실서버 전환 데모)', () => {
  it('appendAssistantReply 는 외부 생성 응답을 영속하고 일련번호를 전진시킨다', async () => {
    const api = createApi();
    const room = await api.createChatRoom({ title: '외부 응답' });
    await api.sendMessage(room.id, '테스트');

    expect(await api.getReplySeq(room.id)).toBe(0);
    const reply = await api.appendAssistantReply(room.id, '서버가 생성한 응답');
    expect(reply.role).toBe('assistant');
    expect(messageText(reply)).toBe('서버가 생성한 응답');
    expect(await api.getReplySeq(room.id)).toBe(1); // 전진

    const page = await api.listMessages({ chatId: room.id });
    expect(page.items[page.items.length - 1]?.id).toBe(reply.id); // 영속 확인
  });

  it('getReplySeq 는 streamReply 와 같은 지표다 - SSE 모드에서 재생성 의미론이 일치한다', async () => {
    const api = createApi();
    const room = await api.createChatRoom({ title: '지표 일치' });
    await api.sendMessage(room.id, '질문');

    await collect(api.streamReply(room.id)); // in-process 응답 1회 -> 일련번호 전진
    expect(await api.getReplySeq(room.id)).toBe(1);
  });
});

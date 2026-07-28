import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { Message } from '@chat/chat-domain';
import { useMessages } from './useMessages';

/**
 * 검색 결과 이동의 심장 - "그 메시지가 나올 때까지 과거 페이지를 되짚는" 로직(STEP 16).
 *
 * 실패하면 사용자에게는 "검색 결과를 눌렀는데 아무 일도 안 일어난다"로 보인다.
 * 커서 페이지네이션을 흉내 낸 가짜 API 로, 몇 번을 불러오고 언제 멈추는지까지 고정한다.
 */
const listMessages = vi.fn();
vi.mock('@/lib/api/chatApi', () => ({
  chatApi: {
    listMessages: (...args: unknown[]) => listMessages(...args),
  },
}));

const PAGE = 50;
const TOTAL = 130;

function message(index: number): Message {
  return {
    id: `msg-${index}`,
    chatId: 'room-1',
    role: index % 2 === 0 ? 'user' : 'assistant',
    parts: [{ type: 'text', text: `${index}번째 메시지` }],
    createdAt: index * 1000,
  };
}

const ALL: Message[] = Array.from({ length: TOTAL }, (_, i) => message(i + 1));

/** before 커서(= 그 메시지 id)보다 앞선 50개를 돌려주는 가짜 페이지네이션. */
function fakePage({ before }: { before?: string }) {
  const end = before ? ALL.findIndex((m) => m.id === before) : ALL.length;
  const start = Math.max(0, end - PAGE);
  const items = ALL.slice(start, end);
  return Promise.resolve({
    items,
    nextBefore: start > 0 ? items[0]!.id : null,
  });
}

beforeEach(() => {
  listMessages.mockReset();
  listMessages.mockImplementation((params: { before?: string }) => fakePage(params));
});

describe('useMessages.loadUntilMessage', () => {
  it('첫 페이지에 이미 있으면 추가 요청 없이 성공한다', async () => {
    const { result } = renderHook(() => useMessages('room-1'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(listMessages).toHaveBeenCalledTimes(1);

    let found: boolean | undefined;
    await act(async () => {
      found = await result.current.loadUntilMessage('msg-130');
    });
    expect(found).toBe(true);
    expect(listMessages).toHaveBeenCalledTimes(1); // 왕복 없음
  });

  it('오래된 메시지는 필요한 페이지만 되짚어 불러온 뒤 목록에 붙인다', async () => {
    const { result } = renderHook(() => useMessages('room-1'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.items).toHaveLength(PAGE);

    let found: boolean | undefined;
    await act(async () => {
      found = await result.current.loadUntilMessage('msg-3'); // 130개 중 3번째 = 2페이지 더
    });

    expect(found).toBe(true);
    expect(listMessages).toHaveBeenCalledTimes(3); // 최초 1 + 과거 2
    expect(result.current.items).toHaveLength(TOTAL);
    // 시간 오름차순이 유지된다(앞으로 이어 붙였으므로).
    expect(result.current.items[0]!.id).toBe('msg-1');
    expect(result.current.items[TOTAL - 1]!.id).toBe('msg-130');
    // 다 불러왔으면 더 볼 과거가 없다.
    expect(result.current.nextBefore).toBeNull();
  });

  it('없는 메시지를 찾으면 전부 훑고 false 로 끝난다(무한 루프 없음)', async () => {
    const { result } = renderHook(() => useMessages('room-1'));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let found: boolean | undefined;
    await act(async () => {
      found = await result.current.loadUntilMessage('msg-없는것');
    });
    expect(found).toBe(false);
    expect(listMessages).toHaveBeenCalledTimes(3); // 커서가 끝나면 멈춘다
  });

  it('상한(maxPages)을 넘겨 계속 부르지 않는다', async () => {
    // 커서가 영원히 나오는(=끝이 없는) 서버를 흉내 낸다 - 상한이 없으면 여기서 멈추지 않는다.
    listMessages.mockImplementation(() =>
      Promise.resolve({ items: [message(999)], nextBefore: 'endless' }),
    );
    const { result } = renderHook(() => useMessages('room-1'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    listMessages.mockClear();

    let found: boolean | undefined;
    await act(async () => {
      found = await result.current.loadUntilMessage('msg-3', 4);
    });
    expect(found).toBe(false);
    expect(listMessages).toHaveBeenCalledTimes(4);
  });
});

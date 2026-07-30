import { describe, expect, it, vi } from 'vitest';
import { ChatApiError, type ChatApi } from '@chat/chat-domain';
import { parseSseEvents, sseStreamReply } from './sseTransport';

/**
 * SSE 파서의 프로토콜 엣지를 고정한다. 가장 최신 플래그십(실 SSE 전송)이 가장 테스트 공백이던
 * 역설을 닫는다. fetch/스트림 없이 순수 함수로 뽑았기에 바이트 경계/CRLF/손상 페이로드를
 * 결정적으로 검증할 수 있다.
 */
describe('parseSseEvents', () => {
  it('단일 청크의 단일 이벤트를 파싱한다', () => {
    const { events, rest } = parseSseEvents('data: {"type":"delta","text":"안녕"}\n\n');
    expect(events).toEqual([{ type: 'delta', text: '안녕' }]);
    expect(rest).toBe('');
  });

  it('한 청크의 여러 이벤트를 모두 소비한다', () => {
    const buffer =
      'data: {"type":"delta","text":"a"}\n\n' + 'data: {"type":"delta","text":"b"}\n\n';
    const { events, rest } = parseSseEvents(buffer);
    expect(events.map((e) => e.text)).toEqual(['a', 'b']);
    expect(rest).toBe('');
  });

  it('이벤트가 바이트 경계로 쪼개지면 미완성분을 rest 로 넘겨 다음 호출에서 완성한다', () => {
    const first = parseSseEvents('data: {"type":"delta","te');
    expect(first.events).toEqual([]);
    expect(first.rest).toBe('data: {"type":"delta","te'); // 미완성 이벤트는 삼키지 않는다

    const second = parseSseEvents(first.rest + 'xt":"조각"}\n\n');
    expect(second.events).toEqual([{ type: 'delta', text: '조각' }]);
    expect(second.rest).toBe('');
  });

  it('CRLF 개행을 정규화해 파싱한다', () => {
    const { events } = parseSseEvents('data: {"type":"done","text":"끝"}\r\n\r\n');
    expect(events).toEqual([{ type: 'done', text: '끝' }]);
  });

  it('data 가 아닌 라인(주석 / event 필드)은 무시한다', () => {
    const buffer = ': keep-alive\n\nevent: ping\n\ndata: {"type":"delta","text":"x"}\n\n';
    const { events } = parseSseEvents(buffer);
    expect(events).toEqual([{ type: 'delta', text: 'x' }]);
  });

  it('손상된 JSON 은 REPLY_FAILED 로 던진다(전송 실패 오분류 방지)', () => {
    expect(() => parseSseEvents('data: {not json}\n\n')).toThrow(ChatApiError);
    try {
      parseSseEvents('data: {not json}\n\n');
      throw new Error('던졌어야 한다');
    } catch (error) {
      expect(error).toBeInstanceOf(ChatApiError);
      expect((error as ChatApiError).code).toBe('REPLY_FAILED');
    }
  });

  it('예상 밖 형태(type 누락 등)도 REPLY_FAILED 로 던진다', () => {
    try {
      parseSseEvents('data: {"foo":1}\n\n');
      throw new Error('던졌어야 한다');
    } catch (error) {
      expect(error).toBeInstanceOf(ChatApiError);
      expect((error as ChatApiError).code).toBe('REPLY_FAILED');
    }
  });
});

/**
 * 회복탄력성(#O4): 일시적 회선 실패에 지수 백오프로 자동 재연결하고, 서버의 결정적 재생을 이용해
 * "이미 보낸 접두"를 건너뛰며 이어받는다(중복 delta 없음). 도메인/4xx/중단은 재시도하지 않는다.
 */
describe('sseStreamReply - 재연결·이어받기', () => {
  // 이벤트 배열을 SSE 본문 스트림으로. errorAfter 개 방출 후 회선 오류(일시 실패)를 흉내낸다.
  function sseStream(events: { type: 'delta' | 'done'; text: string }[], errorAfter?: number) {
    const enc = new TextEncoder();
    let i = 0;
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        if (errorAfter !== undefined && i >= errorAfter) {
          controller.error(new TypeError('network error'));
          return;
        }
        if (i >= events.length) {
          controller.close();
          return;
        }
        const e = events[i++];
        controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
      },
    });
  }
  function res(
    events: { type: 'delta' | 'done'; text: string }[],
    errorAfter?: number,
    status = 200,
  ) {
    if (status >= 400) return new Response(null, { status });
    return new Response(sseStream(events, errorAfter), { status });
  }
  function stubRaw() {
    return {
      getChatRoom: vi.fn(async () => ({})),
      listMessages: vi.fn(async () => ({
        items: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }], createdAt: 0 }],
        nextCursor: null,
      })),
      getReplySeq: vi.fn(async () => 0),
      appendAssistantReply: vi.fn(async (_c: string, text: string) => ({
        id: 'a1',
        role: 'assistant',
        parts: [{ type: 'text', text }],
        createdAt: 0,
      })),
    } as unknown as ChatApi;
  }
  async function collect(gen: AsyncGenerator<{ type: string; text?: string; message?: unknown }>) {
    const deltas: string[] = [];
    let done: unknown = null;
    for await (const ev of gen) {
      if (ev.type === 'delta') deltas.push(ev.text!);
      else done = ev.message;
    }
    return { deltas, done };
  }
  const noBackoff = () => 0;

  it('중간 회선 끊김을 재연결해 중복 없이 이어받는다', async () => {
    const full = [
      { type: 'delta' as const, text: 'Hello ' },
      { type: 'delta' as const, text: 'wor' },
      { type: 'delta' as const, text: 'ld' },
      { type: 'done' as const, text: 'Hello world' },
    ];
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(res(full, 2)) // 1차: "Hello ","wor" 후 끊김
      .mockResolvedValueOnce(res(full)); // 2차: 전체 재생
    const { deltas, done } = await collect(
      sseStreamReply(stubRaw(), 'c1', {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        backoffMs: noBackoff,
      }),
    );
    expect(deltas.join('')).toBe('Hello world'); // 중복 없이 정확히 전체
    expect(deltas).toEqual(['Hello ', 'wor', 'ld']); // 재생분의 접두는 건너뜀
    expect(done).not.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('재시도 한도를 넘기면 REPLY_FAILED 로 종료한다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res([{ type: 'delta', text: 'x' }], 0)); // 항상 즉시 끊김
    await expect(
      collect(
        sseStreamReply(stubRaw(), 'c1', {
          fetchImpl: fetchImpl as unknown as typeof fetch,
          backoffMs: noBackoff,
          maxRetries: 2,
        }),
      ),
    ).rejects.toMatchObject({ code: 'REPLY_FAILED' });
    expect(fetchImpl).toHaveBeenCalledTimes(3); // 최초 1 + 재시도 2
  });

  it('4xx 는 재시도하지 않고 즉시 도메인 오류', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res([], undefined, 400));
    await expect(
      collect(
        sseStreamReply(stubRaw(), 'c1', {
          fetchImpl: fetchImpl as unknown as typeof fetch,
          backoffMs: noBackoff,
        }),
      ),
    ).rejects.toBeInstanceOf(ChatApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // 재시도 없음
  });

  it('정상 경로는 한 번의 연결로 완결한다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      res([
        { type: 'delta', text: '안녕' },
        { type: 'done', text: '안녕' },
      ]),
    );
    const { deltas, done } = await collect(
      sseStreamReply(stubRaw(), 'c1', {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        backoffMs: noBackoff,
      }),
    );
    expect(deltas).toEqual(['안녕']);
    expect(done).not.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

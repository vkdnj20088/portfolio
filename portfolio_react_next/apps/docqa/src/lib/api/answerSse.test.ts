import { describe, expect, it, vi } from 'vitest';
import { extractAnswer, type Answer, type AnswerEvent } from '@chat/search-domain';
import { AnswerProtocolError, parseAnswerSseEvents } from './answerSse';
import { docqa } from '@/lib/docqa';

/**
 * 전송계층(실 SSE)의 프로토콜 엣지와 강등 동작을 고정한다. 파서는 fetch/스트림 없이 순수 함수로
 * 뽑았기에 바이트 경계·CRLF·손상 페이로드를 결정적으로 검증할 수 있고, 폴백은 mock 서버의
 * 결정성을 이용해 "이미 흘린 접두를 건너뛰고 이어받는지"를 본다(중복 delta = 사용자 눈에 보이는 버그).
 */
describe('parseAnswerSseEvents', () => {
  it('단일 청크의 단일 이벤트를 파싱한다', () => {
    const { events, rest } = parseAnswerSseEvents('data: {"type":"delta","text":"연차"}\n\n');
    expect(events).toEqual([{ type: 'delta', text: '연차' }]);
    expect(rest).toBe('');
  });

  it('이벤트가 바이트 경계로 쪼개지면 미완성분을 rest 로 넘겨 다음 호출에서 완성한다', () => {
    const first = parseAnswerSseEvents('data: {"type":"delta","te');
    expect(first.events).toEqual([]);
    expect(first.rest).toBe('data: {"type":"delta","te'); // 미완성 이벤트는 삼키지 않는다

    const second = parseAnswerSseEvents(first.rest + 'xt":"조각"}\n\n');
    expect(second.events).toEqual([{ type: 'delta', text: '조각' }]);
    expect(second.rest).toBe('');
  });

  it('CRLF 를 정규화하고 data 아닌 라인(주석/event)은 무시한다', () => {
    const { events } = parseAnswerSseEvents(
      ': keep-alive\r\n\r\nevent: ping\r\n\r\ndata: {"type":"done","answer":null}\r\n\r\n',
    );
    expect(events).toEqual([{ type: 'done', answer: null }]);
  });

  it('손상된 JSON 은 프로토콜 오류로 던진다(회선 실패로 오분류하지 않게)', () => {
    expect(() => parseAnswerSseEvents('data: {not json}\n\n')).toThrow(AnswerProtocolError);
  });

  it('필드가 빠진 done(근거 반쪽)도 프로토콜 오류로 막는다', () => {
    // spanEnd 누락 - 이걸 통과시키면 하이라이트가 undefined 로 깨진다.
    const broken = 'data: {"type":"done","answer":{"text":"a","passageId":"p","docId":"d"}}\n\n';
    expect(() => parseAnswerSseEvents(broken)).toThrow(AnswerProtocolError);
  });
});

// ── 전송 선택/강등 ──────────────────────────────────────────────────────────
const QUERY = '연차는 며칠 부여되나요?';

function sseBody(events: AnswerEvent[], errorAfter?: number) {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (errorAfter !== undefined && i >= errorAfter) {
        controller.error(new TypeError('network error')); // 회선 끊김
        return;
      }
      if (i >= events.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(events[i++])}\n\n`));
    },
  });
}

function eventsFor(answer: Answer): AnswerEvent[] {
  return [
    ...answer.text
      .split(/(\s+)/)
      .filter(Boolean)
      .map((text) => ({ type: 'delta' as const, text })),
    { type: 'done' as const, answer },
  ];
}

async function collect(gen: AsyncGenerator<AnswerEvent>) {
  const deltas: string[] = [];
  let done: Answer | null = null;
  for await (const event of gen) {
    if (event.type === 'delta') deltas.push(event.text);
    else done = event.answer;
  }
  return { text: deltas.join(''), done };
}

describe('docqa.streamAnswer 전송 선택', () => {
  const answer = extractAnswer(QUERY)!;

  it('정상 경로는 SSE 한 번으로 완결하고 전송을 sse 로 보고한다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(sseBody(eventsFor(answer))));
    const onTransport = vi.fn();
    const { text, done } = await collect(
      docqa.streamAnswer(QUERY, { fetchImpl: fetchImpl as unknown as typeof fetch, onTransport }),
    );
    expect(text).toBe(answer.text);
    expect(done?.docId).toBe(answer.docId);
    expect(onTransport).toHaveBeenCalledWith('sse');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('스트림이 중간에 끊기면 mock 으로 강등해 중복 없이 이어받는다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(sseBody(eventsFor(answer), 3)));
    const onTransport = vi.fn();
    const { text, done } = await collect(
      docqa.streamAnswer(QUERY, {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        onTransport,
        stepMs: 0,
      }),
    );
    expect(text).toBe(answer.text); // 접두 중복 없이 정확히 전체
    expect(done?.text).toBe(answer.text);
    expect(onTransport).toHaveBeenLastCalledWith('mock', expect.any(String));
  });

  it('4xx 는 폴백해서라도 답을 완성한다(데모가 멈추지 않게)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 400 }));
    const onTransport = vi.fn();
    const { text } = await collect(
      docqa.streamAnswer(QUERY, {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        onTransport,
        stepMs: 0,
      }),
    );
    expect(text).toBe(answer.text);
    expect(onTransport).toHaveBeenCalledWith('mock', expect.stringContaining('400'));
  });

  it('사용자 중단은 폴백 대상이 아니다(끊으면 끊긴 채로 끝난다)', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn().mockImplementation(() => {
      controller.abort();
      return Promise.reject(new DOMException('aborted', 'AbortError'));
    });
    const onTransport = vi.fn();
    await expect(
      collect(
        docqa.streamAnswer(QUERY, {
          fetchImpl: fetchImpl as unknown as typeof fetch,
          signal: controller.signal,
          onTransport,
        }),
      ),
    ).rejects.toThrow();
    expect(onTransport).not.toHaveBeenCalledWith('mock', expect.anything());
  });
});

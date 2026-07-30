import { describe, it, expect } from 'vitest';
import { POST } from './route';

/**
 * 라우트 핸들러 직접 호출 테스트. 이 앱의 유일한 서버 로직인데 그동안 클라이언트 전송(mock fetch)만
 * 검증되고 있었다. 거절 경로(잘못된 본문/과대 입력)와 SSE 계약(헤더·done·불응답)을 여기서 고정한다.
 */
function post(body: string, headers: Record<string, string> = {}): Promise<Response> {
  return POST(
    new Request('http://localhost/api/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body,
    }),
  );
}

async function readSse(res: Response): Promise<unknown[]> {
  const text = await res.text();
  return text
    .split('\n\n')
    .filter((chunk) => chunk.startsWith('data:'))
    .map((chunk) => JSON.parse(chunk.slice(5).trim()));
}

describe('POST /api/answer', () => {
  it('본문이 JSON 이 아니면 400', async () => {
    const res = await post('not json');
    expect(res.status).toBe(400);
  });

  it('Content-Length 가 상한을 넘으면 본문을 읽기 전에 413', async () => {
    const res = await post('{}', { 'content-length': '999999' });
    expect(res.status).toBe(413);
  });

  it('질의가 너무 길면 413', async () => {
    const res = await post(JSON.stringify({ query: '가'.repeat(600) }));
    expect(res.status).toBe(413);
  });

  it('SSE 헤더를 정확히 세팅한다(프록시 버퍼링 방지 포함)', async () => {
    const res = await post(JSON.stringify({ query: 'zzz' }));
    expect(res.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-cache, no-transform');
    expect(res.headers.get('x-accel-buffering')).toBe('no');
  });

  it('delta 를 흘리고 마지막 done 에 근거를 실어 보낸다', async () => {
    const events = (await readSse(
      await post(JSON.stringify({ query: '연차는 며칠 부여되나요?' })),
    )) as {
      type: string;
      text?: string;
      answer?: {
        docId: string;
        text: string;
        passageText: string;
        spanStart: number;
        spanEnd: number;
      };
    }[];
    const done = events[events.length - 1];
    expect(done?.type).toBe('done');
    expect(done?.answer?.docId).toBe('HR-01');
    // delta 를 이어붙이면 done 의 답변 텍스트와 정확히 같다(폴백 이어받기가 성립하는 전제).
    const streamed = events
      .filter((e) => e.type === 'delta')
      .map((e) => e.text ?? '')
      .join('');
    expect(streamed).toBe(done?.answer?.text);
    // 근거 span 은 문단 원문의 실제 구간이다(생성이 아님).
    const a = done?.answer;
    expect(a && a.passageText.slice(a.spanStart, a.spanEnd)).toBe(a?.text);
  });

  it('코퍼스에 답이 없으면 delta 없이 done(answer=null)', async () => {
    const events = await readSse(
      await post(JSON.stringify({ query: '주차장은 몇 시까지 운영하나요?' })),
    );
    expect(events).toEqual([{ type: 'done', answer: null }]);
  });
});

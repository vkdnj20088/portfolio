import { describe, it, expect } from 'vitest';
import { extractAnswer } from './mrc';
import { createDocQaApi } from './docQaApi';

describe('extractAnswer (추출형 MRC)', () => {
  it('답변 구간은 코퍼스 문단의 실제 부분문자열이다(생성 아님 = 환각 없음)', () => {
    const ans = extractAnswer('연차는 며칠 부여되나요?');
    expect(ans).not.toBeNull();
    // 근거 span 이 문단 원문 안의 구간과 정확히 일치.
    expect(ans!.passageText.slice(ans!.spanStart, ans!.spanEnd)).toBe(ans!.text);
    expect(ans!.docId).toBe('HR-01');
    expect(ans!.confidence).toBeGreaterThan(0);
  });

  it('동의어로 물어도 근거를 찾는다(휴가->연차/반차)', () => {
    const ans = extractAnswer('반차는 어떻게 써요?');
    expect(ans).not.toBeNull();
    expect(ans!.docId).toBe('HR-01');
  });

  it('근거가 약하면 null 로 "정답 없음"을 정직하게 반환', () => {
    expect(extractAnswer('zzzz9999 무관한질의 xkcd')).toBeNull();
  });

  it('코퍼스에 없는 주제는 "그럴듯한 오답" 대신 침묵한다', () => {
    // 어휘가 일부 겹쳐도(이름/시/운영/휴직) 답을 만들면 안 되는 질문들.
    // 단순 토큰 겹침 채점이던 시절엔 이 전부가 엉뚱한 문단을 자신 있게 인용했다.
    for (const q of [
      '주차장은 몇 시까지 운영하나요?',
      '대표이사 이름이 뭔가요?',
      '육아휴직은 얼마나 쓸 수 있나요?',
      '해외 지사는 몇 개인가요?',
    ]) {
      expect(extractAnswer(q), q).toBeNull();
    }
  });

  it('근거 span 은 문단 안의 제자리를 가리킨다(하이라이트 어긋남 방지)', () => {
    const ans = extractAnswer('커스텀 확장자는 몇 개까지 등록하나요?');
    expect(ans).not.toBeNull();
    expect(ans!.passageText.slice(ans!.spanStart, ans!.spanEnd)).toBe(ans!.text);
  });
});

describe('createDocQaApi.streamAnswer', () => {
  it('delta 를 흘리고 마지막에 근거 포함 done 을 낸다', async () => {
    const api = createDocQaApi({ stepMs: 0 });
    const events = [];
    for await (const e of api.streamAnswer('출금할 때 뭐가 필요해?')) events.push(e);
    const done = events[events.length - 1];
    expect(done?.type).toBe('done');
    if (done?.type === 'done') {
      expect(done.answer).not.toBeNull();
      // delta 를 이어붙이면 최종 답변 텍스트가 된다(공백 정규화 후 비교).
      const streamed = events
        .filter((e) => e.type === 'delta')
        .map((e) => (e.type === 'delta' ? e.text : ''))
        .join('');
      expect(streamed.replace(/\s+/g, '')).toBe(done.answer!.text.replace(/\s+/g, ''));
    }
  });

  it('답 없으면 done(answer=null)', async () => {
    const api = createDocQaApi({ stepMs: 0 });
    const events = [];
    for await (const e of api.streamAnswer('zzzz9999 xkcd')) events.push(e);
    expect(events).toEqual([{ type: 'done', answer: null }]);
  });
});

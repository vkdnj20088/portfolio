import { describe, expect, it } from 'vitest';
import { buildQuery, localToIso, localToMillis, millisToLocal } from './ipQuery';

/*
 * 변환 기준은 **실행 환경(기기)의 시간대**다. 그래서 이 테스트는 `'2024-06-01T00:00:00.000Z'`
 * 같은 리터럴을 기대값으로 쓸 수 없다 - TZ 를 바꾸면 정답이 바뀌므로, 개발 머신에서는 통과하고
 * CI(UTC)에서는 깨지는(또는 반대로) 테스트가 된다. 실제로 그런 상태였다.
 *
 * 대신 **기기 TZ 와 무관하게 참인 성질**을 검증한다:
 *   1) 입력한 벽시계가 그 사람의 시계로 그대로 읽힌다 (해석 기준 = 기기 TZ)
 *   2) 표시 <-> 입력 왕복이 시점을 보존한다
 *   3) 저장 형식은 UTC 절대 시점이다
 *
 * (1)의 판정에는 `Intl.DateTimeFormat` 을 **독립 오라클**로 쓴다. `new Date(y, m, d, ...)` 로
 * 기대값을 만들면 검사 대상과 같은 경로를 타서 무엇도 증명하지 못한다(항진). Intl 은 IANA
 * 데이터로 별도 계산하므로 교차 검증이 된다.
 *
 * 이 파일은 `TZ=UTC` / `TZ=America/Los_Angeles` / `TZ=Australia/Adelaide`(30분 오프셋) 에서
 * 모두 같은 결과여야 한다 - 그 자체가 "환경에 의존하지 않는다"의 증거다.
 */

/** 절대 시점을 실행 환경 TZ 의 벽시계로 읽는다(검사 대상과 다른 경로 - Intl/IANA). */
function wallClock(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(ms));
}

describe('localToMillis / localToIso - 기기 TZ 벽시계 해석', () => {
  it('빈 값은 null', () => {
    expect(localToMillis('')).toBeNull();
    expect(localToIso('')).toBeNull();
  });

  it('파싱 불가 값은 null', () => {
    expect(localToMillis('not-a-date')).toBeNull();
    expect(localToIso('nope')).toBeNull();
  });

  it('날짜만 있는 값은 받지 않는다 - JS 가 날짜만이면 UTC, 날짜+시각이면 지역으로 읽는다', () => {
    // 통과시키면 기준이 조용히 갈린다. 형태 검사로 그 갈림길을 닫는 것이 이 규칙의 전부다.
    expect(localToMillis('2024-06-01')).toBeNull();
    expect(localToIso('2024-06-01')).toBeNull();
  });

  it('입력한 벽시계가 그 사람의 시계로 그대로 읽힌다(Intl 교차 검증)', () => {
    expect(wallClock(localToMillis('2024-06-01T09:00')!)).toBe('2024-06-01, 09:00');
  });

  it('자정 - 날짜 경계에서도 벽시계가 유지된다(오프셋 부호와 무관)', () => {
    expect(wallClock(localToMillis('2024-06-01T00:00')!)).toBe('2024-06-01, 00:00');
    expect(wallClock(localToMillis('2024-06-01T23:59')!)).toBe('2024-06-01, 23:59');
  });

  it('초 단위가 붙은 형식도 같은 값으로 읽는다(브라우저마다 형식이 갈린다)', () => {
    expect(localToMillis('2024-06-01T09:00:00')).toBe(localToMillis('2024-06-01T09:00'));
  });

  it('늦은 시각일수록 큰 millis(단조성)', () => {
    expect(localToMillis('2024-06-01T10:00')!).toBeGreaterThan(localToMillis('2024-06-01T09:00')!);
  });

  it('저장 형식은 UTC 절대 시점이다 - 같은 millis 의 ISO', () => {
    const ms = localToMillis('2024-06-01T09:00')!;
    expect(localToIso('2024-06-01T09:00')).toBe(new Date(ms).toISOString());
    expect(localToIso('2024-06-01T09:00')!.endsWith('Z')).toBe(true);
  });
});

describe('millisToLocal - 표시 <-> 입력 왕복', () => {
  it('폼에 되돌린 값이 화면과 같은 벽시계다', () => {
    const ms = localToMillis('2024-06-01T09:00')!;
    expect(millisToLocal(ms)).toBe('2024-06-01T09:00');
  });

  it('왕복이 시점을 보존한다(millisToLocal -> localToMillis)', () => {
    // 서머타임 전환이 있는 지역에서도 각 시점의 오프셋으로 읽고 쓰므로 왕복이 닫힌다.
    for (const v of ['2024-01-15T12:00', '2024-06-01T00:00', '2024-07-15T12:00', '2024-12-31T23:59']) {
      const ms = localToMillis(v)!;
      expect(localToMillis(millisToLocal(ms))).toBe(ms);
    }
  });
});

describe('buildQuery - 키셋 조회 파라미터 조립', () => {
  it('빈 입력은 size 만', () => {
    expect(buildQuery({ pageSize: 30 })).toEqual({ size: '30' });
  });

  it('내용/기간/커서를 채운다(시각은 millis)', () => {
    const out = buildQuery({
      q: '사내',
      startLocal: '2024-06-01T00:00',
      endLocal: '2024-06-02T00:00',
      cursor: 'abc',
      pageSize: 30,
    });
    expect(out.q).toBe('사내');
    // 값 자체는 기기 TZ 에 따라 달라지므로, 변환을 localToMillis 에 위임했는지와
    // 하한 < 상한(하루 차이)이라는 관계를 본다.
    expect(out.startFrom).toBe(String(localToMillis('2024-06-01T00:00')));
    expect(out.endTo).toBe(String(localToMillis('2024-06-02T00:00')));
    expect(Number(out.endTo) - Number(out.startFrom)).toBe(24 * 60 * 60 * 1000);
    expect(out.cursor).toBe('abc');
    expect(out.size).toBe('30');
  });

  it('공백 검색어는 빠지고, 커서 없음(reset)이면 cursor 미포함', () => {
    const out = buildQuery({ q: '   ', cursor: null, pageSize: 30 });
    expect(out).not.toHaveProperty('q');
    expect(out).not.toHaveProperty('cursor');
  });

  it('빈 시간 입력은 startFrom/endTo 를 넣지 않는다', () => {
    const out = buildQuery({ startLocal: '', endLocal: '', pageSize: 50 });
    expect(out).toEqual({ size: '50' });
  });
});

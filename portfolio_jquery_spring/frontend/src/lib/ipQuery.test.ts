import { describe, expect, it } from 'vitest';
import { buildQuery, localToIso, localToMillis } from './ipQuery';

// TZ=UTC 로 실행(package.json test 스크립트) - datetime-local 해석이 결정적이 된다.
describe('localToMillis / localToIso - 디바이스 TZ 시간 변환', () => {
  it('빈 값은 null', () => {
    expect(localToMillis('')).toBeNull();
    expect(localToIso('')).toBeNull();
  });

  it('파싱 불가 값은 null', () => {
    expect(localToMillis('not-a-date')).toBeNull();
    expect(localToIso('nope')).toBeNull();
  });

  it('로컬 시각을 UTC epoch/ISO 로 변환(TZ=UTC 기준)', () => {
    expect(localToMillis('2024-06-01T09:00')).toBe(Date.UTC(2024, 5, 1, 9, 0));
    expect(localToIso('2024-06-01T09:00')).toBe('2024-06-01T09:00:00.000Z');
  });

  it('늦은 시각일수록 큰 millis(단조성)', () => {
    expect(localToMillis('2024-06-01T10:00')!).toBeGreaterThan(localToMillis('2024-06-01T09:00')!);
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
    expect(out.startFrom).toBe(String(Date.UTC(2024, 5, 1, 0, 0)));
    expect(out.endTo).toBe(String(Date.UTC(2024, 5, 2, 0, 0)));
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

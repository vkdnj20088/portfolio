import { describe, expect, it } from 'vitest';
import { backoffFormula, fmtClock, fmtSec, fmtUntil } from './relayMessages';

describe('backoffFormula - 표시 산식은 실제값에서 역산한다', () => {
  it('지터 0 이면 지수부 그대로', () => {
    expect(backoffFormula(1, 1000)).toBe('기저 1s × 2^0 = 1.0s, 지터 +0.0s');
    expect(backoffFormula(2, 2000)).toBe('기저 1s × 2^1 = 2.0s, 지터 +0.0s');
  });

  it('지터는 실제 백오프 - 지수부', () => {
    // 백오프 2100ms = 지수 2000ms + 지터 100ms (표시와 실행이 같아야 한다)
    expect(backoffFormula(2, 2100)).toBe('기저 1s × 2^1 = 2.0s, 지터 +0.1s');
  });

  it('상한에 닿으면 산식 대신 그 사실을 말한다', () => {
    expect(backoffFormula(10, 10000)).toBe('상한 10.0s 적용');
  });
});

describe('fmtSec / fmtUntil', () => {
  it('ms 를 소수 1자리 초로', () => {
    expect(fmtSec(1000)).toBe('1.0s');
    expect(fmtSec(2149)).toBe('2.1s');
  });

  it('다음 시도까지 남은 시간 - 지났으면 "곧"', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    expect(fmtUntil('2026-01-01T00:00:02.500Z', now)).toBe('+2.5s');
    expect(fmtUntil('2025-12-31T23:59:59Z', now)).toBe('곧');
    expect(fmtUntil(null, now)).toBe('');
  });
});

describe('fmtClock - 접속 기기 시간대 표기', () => {
  it('로컬 시각의 HH:MM:SS.mmm (vitest 는 TZ=UTC 로 고정해 결정적)', () => {
    expect(fmtClock('2026-01-02T03:04:05.067Z')).toBe('03:04:05.067');
  });
});

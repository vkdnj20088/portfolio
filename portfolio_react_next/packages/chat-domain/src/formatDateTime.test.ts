import { describe, expect, it } from 'vitest';
import { formatDateTime, KST_OFFSET_MS } from './formatDateTime';

/*
 * 기준은 **KST(UTC+9) 고정**이다. 그래서 입력을 `new Date(y, m, d, ...)`(실행 환경 지역 시간)로
 * 만들면 안 된다 - 개발 머신이 Asia/Seoul 이면 통과하고 CI(UTC)에서는 실패하는, 환경에 따라
 * 답이 갈리는 테스트가 된다(실제로 그런 상태였다).
 *
 * 입력은 항상 Date.UTC 로 절대 시점을 만들고, 기대값은 그 시점의 KST 벽시계를 손으로 적는다.
 */
describe('formatDateTime - KST(UTC+9) 고정 표기, YYYY-MM-DD HH:mm', () => {
  it('UTC 00:07 은 KST 09:07 이다 - 월/일/시/분 2자리 패딩', () => {
    expect(formatDateTime(Date.UTC(2026, 0, 5, 0, 7))).toBe('2026-01-05 09:07');
  });

  it('날짜 경계를 넘긴다 - UTC 15:00 은 다음 날 KST 00:00', () => {
    expect(formatDateTime(Date.UTC(2025, 11, 31, 15, 0))).toBe('2026-01-01 00:00');
  });

  it('연말 경계값 - KST 2025-12-31 23:59', () => {
    expect(formatDateTime(Date.UTC(2025, 11, 31, 14, 59))).toBe('2025-12-31 23:59');
  });

  it('서머타임 영향이 없다 - 1월과 7월의 오프셋이 같다', () => {
    expect(formatDateTime(Date.UTC(2026, 0, 15, 3, 0))).toBe('2026-01-15 12:00');
    expect(formatDateTime(Date.UTC(2026, 6, 15, 3, 0))).toBe('2026-07-15 12:00');
  });

  it('오프셋 상수가 9시간이다', () => {
    expect(KST_OFFSET_MS).toBe(9 * 60 * 60 * 1000);
  });
});

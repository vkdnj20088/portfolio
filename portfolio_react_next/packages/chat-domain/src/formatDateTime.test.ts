import { describe, expect, it } from 'vitest';
import { formatDateTime } from './formatDateTime';

describe('formatDateTime (명세: YYYY-MM-DD HH:mm)', () => {
  it('월/일/시/분을 2자리로 패딩한다', () => {
    const t = new Date(2026, 0, 5, 9, 7).getTime(); // 2026-01-05 09:07 (로컬)
    expect(formatDateTime(t)).toBe('2026-01-05 09:07');
  });

  it('연말 경계값도 올바르다', () => {
    const t = new Date(2025, 11, 31, 23, 59).getTime();
    expect(formatDateTime(t)).toBe('2025-12-31 23:59');
  });
});

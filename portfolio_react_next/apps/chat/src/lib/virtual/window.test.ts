import { describe, expect, it } from 'vitest';
import { computeVariableWindow, toOffsets } from './window';

// 균일 높이 40px 20개, 뷰포트 100px, 오버스캔 2 (고정 높이도 가변의 특수 케이스)
const uniform = toOffsets(Array<number>(20).fill(40));

describe('computeVariableWindow - 가변 높이 가상화', () => {
  it('빈 목록은 0 구간', () => {
    expect(
      computeVariableWindow({ scrollTop: 0, viewportH: 100, offsets: [], overscan: 2 }),
    ).toEqual({
      start: 0,
      end: 0,
      padTop: 0,
      padBottom: 0,
    });
  });

  it('맨 위: start 0, 스페이서가 전체 높이를 보존', () => {
    const w = computeVariableWindow({
      scrollTop: 0,
      viewportH: 100,
      offsets: uniform,
      overscan: 2,
    });
    expect(w.start).toBe(0);
    expect(w.padTop).toBe(0);
    // 총 높이 = padTop + 렌더 높이 + padBottom = 20*40
    const rendered =
      w.end === 0 ? 0 : uniform[w.end - 1]! - (w.start === 0 ? 0 : uniform[w.start - 1]!);
    expect(w.padTop + rendered + w.padBottom).toBe(800);
  });

  it('중간 스크롤: 오버스캔 포함, 스페이서 합이 전체 높이 유지', () => {
    const w = computeVariableWindow({
      scrollTop: 400,
      viewportH: 100,
      offsets: uniform,
      overscan: 2,
    });
    // 400px = 10번째 항목 경계, 뷰포트 100 = 항목 2~3개
    expect(w.start).toBeLessThanOrEqual(10);
    expect(w.end).toBeGreaterThan(10);
    const rendered = uniform[w.end - 1]! - (w.start === 0 ? 0 : uniform[w.start - 1]!);
    expect(w.padTop + rendered + w.padBottom).toBe(800);
  });

  it('맨 아래로 스크롤 초과해도 안전(클램프)', () => {
    const w = computeVariableWindow({
      scrollTop: 999999,
      viewportH: 100,
      offsets: uniform,
      overscan: 2,
    });
    expect(w.end).toBe(20);
    expect(w.padBottom).toBe(0);
  });

  it('가변 높이: 큰 항목을 지나면 가시 구간이 그에 맞게 좁아진다', () => {
    // 높이 [10, 500, 10, 10, 10] - 두 번째가 매우 큼
    const offsets = toOffsets([10, 500, 10, 10, 10]);
    // scrollTop 이 큰 항목 한가운데(예: 200)면 그 항목(index 1)만 대부분 보인다
    const w = computeVariableWindow({ scrollTop: 200, viewportH: 100, offsets, overscan: 0 });
    expect(w.start).toBe(1);
    expect(w.end).toBe(2); // 큰 항목 하나로 뷰포트가 찬다
  });

  it('렌더 항목 수는 전체 크기와 무관하게 상한이 있다(가상화 이득)', () => {
    const small = computeVariableWindow({
      scrollTop: 200,
      viewportH: 100,
      offsets: toOffsets(Array(50).fill(40)),
      overscan: 2,
    });
    const huge = computeVariableWindow({
      scrollTop: 200,
      viewportH: 100,
      offsets: toOffsets(Array(100000).fill(40)),
      overscan: 2,
    });
    expect(small.end - small.start).toBe(huge.end - huge.start);
  });
});

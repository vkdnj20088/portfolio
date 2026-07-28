import { describe, expect, it } from "vitest";
import { computeWindow } from "./window";

const base = { viewportH: 240, rowH: 24, total: 1000, overscan: 4 };

describe("computeWindow - 가상화 가시 구간", () => {
  it("맨 위: start 0, 오버스캔은 위로 넘치지 않음", () => {
    const w = computeWindow({ ...base, scrollTop: 0 });
    expect(w.start).toBe(0);
    // 보이는 10행(240/24) + 아래 오버스캔 4 = 14
    expect(w.end).toBe(14);
    expect(w.padTop).toBe(0);
    expect(w.padBottom).toBe((1000 - 14) * 24);
  });

  it("중간 스크롤: 위/아래 오버스캔 포함, 스페이서가 전체 높이를 보존", () => {
    const w = computeWindow({ ...base, scrollTop: 24 * 100 }); // 100행 지점
    expect(w.start).toBe(96); // 100 - overscan 4
    expect(w.end).toBe(114); // 100 + 10 + 4
    expect(w.padTop).toBe(96 * 24);
    expect(w.padTop + (w.end - w.start) * 24 + w.padBottom).toBe(1000 * 24); // 총 높이 불변
  });

  it("맨 아래: end 가 total 로 클램프, scrollTop 초과도 안전", () => {
    const w = computeWindow({ ...base, scrollTop: 999999 });
    expect(w.end).toBe(1000);
    expect(w.padBottom).toBe(0);
  });

  it("빈 목록/0 행높이는 0 구간", () => {
    expect(computeWindow({ ...base, total: 0, scrollTop: 0 }).end).toBe(0);
    expect(computeWindow({ ...base, rowH: 0, scrollTop: 0 }).end).toBe(0);
  });

  it("렌더 행 수는 total 과 무관하게 상한이 있다(가상화 이득)", () => {
    const small = computeWindow({ ...base, total: 50, scrollTop: 240 });
    const huge = computeWindow({ ...base, total: 100000, scrollTop: 240 });
    expect(small.end - small.start).toBe(huge.end - huge.start); // DOM 행 수 동일
  });
});

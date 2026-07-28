import { beforeEach, describe, expect, it } from "vitest";
import { useOrderDraftStore } from "./orderDraftStore";

describe("orderDraftStore - 호가->주문폼 가격 전달", () => {
  beforeEach(() => useOrderDraftStore.setState({ price: null, seq: 0 }));

  it("setPrice 가 가격을 싣고 seq 를 증가시킨다", () => {
    useOrderDraftStore.getState().setPrice("95000000");
    expect(useOrderDraftStore.getState().price).toBe("95000000");
    expect(useOrderDraftStore.getState().seq).toBe(1);
  });

  it("같은 가격을 다시 눌러도 seq 는 증가한다(소비측 재반응)", () => {
    const s = useOrderDraftStore.getState();
    s.setPrice("100");
    s.setPrice("100");
    expect(useOrderDraftStore.getState().seq).toBe(2);
  });
});

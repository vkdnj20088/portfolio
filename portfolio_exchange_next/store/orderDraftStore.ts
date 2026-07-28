"use client";
import { create } from "zustand";

// 오더북 -> 주문폼 가격 전달용 얇은 스토어. 호가 행을 클릭/Enter 하면 그 가격이 주문폼에 실린다
// (키보드로도 호가를 골라 주문가로 채울 수 있게). seq 는 같은 가격을 다시 눌러도 소비측이
// 반응하도록 하는 단조 카운터.
interface OrderDraftState {
  price: string | null;
  seq: number;
  setPrice: (price: string) => void;
}

export const useOrderDraftStore = create<OrderDraftState>()((set) => ({
  price: null,
  seq: 0,
  setPrice: (price) => set((s) => ({ price, seq: s.seq + 1 })),
}));

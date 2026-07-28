"use client";
import { create } from "zustand";
import {
  cancel,
  evaluateResting,
  initialSession,
  submit,
  type BookLevels,
  type SubmitResult,
  type TradeSession,
} from "@/lib/trade/session";
import type { OrderType, Side } from "@/lib/engine/types";

// 주문 id/ts 시퀀스 - 단조 증가(가격-시간 우선의 "시간"). 시계를 읽지 않아 재현 가능하다.
let seq = 0;

interface TradeState {
  session: TradeSession;
  /** 주문 접수 + 즉시 매칭. 성공 시에만 세션 갱신, 결과(체결/거절)를 반환. */
  place: (market: string, side: Side, type: OrderType, price: string | undefined, qty: string, book: BookLevels) => SubmitResult;
  /** 시세 갱신마다 호출 - 미체결 지정가가 가로질리면 체결. */
  onTick: (market: string, price: string) => void;
  cancelOrder: (id: string) => void;
  reset: () => void;
}

export const useTradeStore = create<TradeState>()((set, get) => ({
  session: initialSession(),
  place: (market, side, type, price, qty, book) => {
    const ts = ++seq;
    const { session, result } = submit(
      get().session,
      { id: `me-${ts}`, market, side, type, price, qty, ts },
      book,
    );
    if (result.ok) set({ session });
    return result;
  },
  onTick: (market, price) => {
    const { session, filledIds } = evaluateResting(get().session, market, price, ++seq);
    if (filledIds.length) set({ session });
  },
  cancelOrder: (id) => set((s) => ({ session: cancel(s.session, id) })),
  reset: () => set({ session: initialSession() }),
}));

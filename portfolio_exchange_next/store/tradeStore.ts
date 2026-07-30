"use client";
import { create } from "zustand";
import {
  cancel,
  evaluateResting,
  initialSession,
  submit,
  type BookLevels,
  type SessionOrderType,
  type SubmitResult,
  type TradeSession,
} from "@/lib/trade/session";
import type { Side } from "@/lib/engine/types";

// 주문 id/ts 시퀀스 - 단조 증가(가격-시간 우선의 "시간"). 시계를 읽지 않아 재현 가능하다.
let seq = 0;

interface TradeState {
  session: TradeSession;
  /** 주문 접수 + 즉시 매칭. 성공 시에만 세션 갱신, 결과(체결/거절)를 반환. */
  place: (market: string, side: Side, type: SessionOrderType, price: string | undefined,
    qty: string, book: BookLevels, triggerPrice?: string) => SubmitResult;
  /**
   * 시세 갱신마다 호출 - 스탑 트리거 판정 후 미체결 지정가 교차를 평가한다(#E1).
   * 트리거만 일어나고 체결이 없어도 세션이 바뀌므로(type/triggered 전환) 둘 중 하나라도 있으면 갱신한다.
   */
  onTick: (market: string, price: string) => void;
  cancelOrder: (id: string) => void;
  reset: () => void;
}

export const useTradeStore = create<TradeState>()((set, get) => ({
  session: initialSession(),
  place: (market, side, type, price, qty, book, triggerPrice) => {
    const ts = ++seq;
    const { session, result } = submit(
      get().session,
      { id: `me-${ts}`, market, side, type, price, triggerPrice, qty, ts },
      book,
    );
    if (result.ok) set({ session });
    return result;
  },
  onTick: (market, price) => {
    const { session, filledIds, triggeredIds } = evaluateResting(get().session, market, price, ++seq);
    if (filledIds.length || triggeredIds.length) set({ session });
  },
  cancelOrder: (id) => set((s) => ({ session: cancel(s.session, id) })),
  reset: () => set({ session: initialSession() }),
}));

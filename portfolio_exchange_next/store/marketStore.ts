"use client";
import { create } from "zustand";
import { useEffect } from "react";
import { marketSource } from "@/lib/sync/marketSource";
import type { MarketSnapshot } from "@/lib/mock/data";
interface MarketState { snapshots: Record<string, MarketSnapshot>; apply: (m: string, s: MarketSnapshot) => void; }
export const useMarketStore = create<MarketState>()((set) => ({
  snapshots: {},
  apply: (market, snap) => set((st) => ({ snapshots: { ...st.snapshots, [market]: snap } })),
}));
/** 마켓 1개 구독: 변경 시 자동 해지->재구독, 언마운트 정리(STOMP 재구독 계승). initial=서버 초기 스냅샷 */
export function useMarketFeed(market: string, initial?: MarketSnapshot): MarketSnapshot | undefined {
  const apply = useMarketStore((s) => s.apply);
  useEffect(() => {
    if (initial && !useMarketStore.getState().snapshots[market]) apply(market, initial);
    // 멀티탭 동기 소스(#E8): 리더면 엔진 구동+방송, 팔로워면 리더 스냅샷 수신. 단독 탭은 기존과 동일.
    return marketSource.subscribe(market, (snap) => apply(market, snap));
  }, [market, apply, initial]);
  return useMarketStore((s) => s.snapshots[market]) ?? initial;
}

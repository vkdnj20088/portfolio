"use client";
import { useTabRole } from "@/lib/sync/marketSource";

// 멀티탭 동기 역할 표시(#E8). 여러 탭을 열면 한 탭(리더)이 시세를 계산해 나머지(팔로워)와 공유한다.
const LABEL: Record<string, string> = {
  solo: "단독 탭",
  leader: "동기화 · 리더",
  follower: "동기화 · 팔로워",
};

export default function TabSyncBadge() {
  const role = useTabRole();
  return (
    <span
      className={`sync-badge sync-${role}`}
      title="여러 탭을 열면 한 탭(리더)이 시세를 계산해 BroadcastChannel 로 다른 탭과 공유합니다. 리더 탭을 닫으면 다른 탭이 자동 승격됩니다."
    >
      <span className="sync-dot" aria-hidden="true" />
      {LABEL[role]}
    </span>
  );
}

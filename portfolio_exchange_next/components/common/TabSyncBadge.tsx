"use client";
import { useTabRole } from "@/lib/sync/marketSource";

// 멀티탭 동기 역할 표시(#E8). 여러 탭을 열면 한 탭(리더)이 시세를 계산해 나머지(팔로워)와 공유한다.
const LABEL: Record<string, string> = {
  solo: "단독 탭",
  leader: "동기화 · 리더",
  follower: "동기화 · 팔로워",
};

const DESC =
  "여러 탭을 열면 한 탭(리더)이 시세를 계산해 BroadcastChannel 로 다른 탭과 공유합니다. 리더 탭을 닫으면 다른 탭이 자동 승격됩니다.";

export default function TabSyncBadge() {
  const role = useTabRole();
  return (
    <>
      {/* 설명이 title 속성에만 있었다. title 은 마우스에서만 뜨고 보조기술 노출은 구현마다 다르다 -
          같은 문장을 sr-only 로 두고 describedby 로 묶어 읽히는 경로를 명시한다.
          터치에서 보이게 하려면 hover/focus 콘텐츠 규칙(WCAG 1.4.13: 유지·해제 가능)을 만족하는
          디스클로저가 필요해 여기서는 넣지 않았다 - 배지는 상태 표시이고 조작이 아니다. */}
      <span className={`sync-badge sync-${role}`} title={DESC} aria-describedby="sync-role-desc">
        <span className="sync-dot" aria-hidden="true" />
        {LABEL[role]}
      </span>
      <span id="sync-role-desc" className="sr-only">{DESC}</span>
    </>
  );
}

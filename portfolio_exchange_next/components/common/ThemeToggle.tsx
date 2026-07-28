"use client";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { IconMoon, IconSun } from "./icons";
// 하이드레이션 여부를 React 권장 방식으로 감지 - 서버 스냅샷 false, 클라 스냅샷 true.
// setState-in-effect 없이 SSR/CSR 마크업을 안전히 가른다(테마 아이콘 hydration 불일치 방지).
const noop = () => () => {};
function useHydrated(): boolean {
  return useSyncExternalStore(noop, () => true, () => false);
}
export default function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useHydrated();
  const dark = resolvedTheme === "dark";
  return (
    <button className="theme-toggle" aria-label="테마 전환" onClick={() => setTheme(dark ? "light" : "dark")}>
      {/* 마운트 전에는 서버/클라 동일하게 달 아이콘(하이드레이션 정합), 이후 현재 테마 기준으로 전환 아이콘 */}
      {mounted && dark ? <IconSun /> : <IconMoon />}
    </button>
  );
}

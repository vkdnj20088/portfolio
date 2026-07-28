"use client";
import { ThemeProvider } from "next-themes";
// nonce 는 next-themes 가 주입하는 인라인 스크립트에 실린다(CSP script-src nonce 정합). #E6
// 기본값은 시스템 테마다. 예전엔 light 로 고정했지만(거래소 UI 의 관례가 라이트라서),
// 다크 OS 사용자에게 흰 화면이 튀고 인트로(다크)와 톤도 어긋났다. 팔레트가 이미 양쪽 다
// 정의돼 있고 PriceChart 가 resolvedTheme 에 반응해 차트 크롬까지 따라오므로 전환 비용이 없다.
// 토글로 고른 값은 next-themes 가 localStorage 에 저장해 시스템 설정을 계속 덮어쓴다.
export default function Providers({ children, nonce }: { children: React.ReactNode; nonce?: string }) {
  return (
    <ThemeProvider attribute="data-theme" defaultTheme="system" enableSystem disableTransitionOnChange nonce={nonce}>
      {children}
    </ThemeProvider>
  );
}

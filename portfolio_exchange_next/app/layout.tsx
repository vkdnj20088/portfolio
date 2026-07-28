import type { Metadata } from "next";
import { headers } from "next/headers";
import { Noto_Sans_KR, Roboto } from "next/font/google";
import "./globals.css";
import Providers from "@/components/common/Providers";
import AppShell from "@/components/common/AppShell";
const noto = Noto_Sans_KR({ variable: "--font-sans", subsets: ["latin"], weight: ["400", "500", "700"] });
const roboto = Roboto({ variable: "--font-num", subsets: ["latin"], weight: ["400", "500", "700"] });

// CSP nonce(middleware)를 스크립트에 실으려면 요청 시점 렌더가 필요하다 - 정적 프리렌더는
// per-request nonce 를 넣을 수 없어 script-src 의 nonce/strict-dynamic 이 스크립트를 막는다. #E6
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "JC Exchange - 최종은의 React + Next 포트폴리오 (거래소 데모)",
  description: "최종은(Jongeun Choi)의 React + Next 포트폴리오. 가상자산 거래소 프론트엔드 재구성 데모 (실서비스 아님, 더미 데이터)",
};
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="ko" suppressHydrationWarning className={`${noto.variable} ${roboto.variable}`}>
      <body>
        <div className="demo-badge">최종은의 React + Next 포트폴리오 · 거래소 데모 · 실서비스 아님 · 더미 데이터</div>
        <Providers nonce={nonce}>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}

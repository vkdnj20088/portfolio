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
        {/* 배지는 "무엇이 아닌지"(실서비스 아님)만 말하고 있었다. 트레이딩 화면만 본 사람에게는
            무엇을 보면 되는지가 없어서, 그 한 줄을 덧붙인다. 거래 UI 안이 아니라 이 바에 두는
            이유: 화면 어느 칸에 넣어도 그 칸의 성격을 흐린다. */}
        <div className="demo-badge">
          <span>최종은의 React + Next 포트폴리오 · 거래소 데모 · 실서비스 아님 · 더미 데이터</span>
          {/* 귀속 줄이 스택 이름까지만 말한다. 서브도메인으로 직접 들어온 평가자에게는 이
              바가 유일한 자기소개라, 만든 사람의 역할을 인트로와 같은 표기로 한 줄 더 둔다. */}
          <span className="db-role">Front-end 파트장 · Full-stack · IT 경력 12년+</span>
          <span className="db-look">실무에서 호가창을 20단으로 늘리고 차트를 옮겼던 작업의 재현입니다. 호가를 누르면 주문가로 들어가고, 주문 유형에 스탑이 있습니다.</span>
        </div>
        <Providers nonce={nonce}>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}

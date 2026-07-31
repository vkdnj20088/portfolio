"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import ThemeToggle from "./ThemeToggle";
import TabSyncBadge from "./TabSyncBadge";
import { IconAssets, IconBell, IconChart, IconMenu, IconTransfer } from "./icons";
import { usePortfolioHome } from "@/lib/portfolioHome";
import type { ReactElement, SVGProps } from "react";
// 서버 렌더/no-JS 용 기본값. 실제 목적지는 마운트 후 현재 호스트에서 조립한다 - 호스트가
// IP 에서 도메인으로 바뀌어도(그 반대도) 다시 빌드할 필요가 없다.
const PORTFOLIO_FALLBACK = process.env.NEXT_PUBLIC_PORTFOLIO_URL ?? "/";
const TABS: { href: string; key: string; label: string; Icon: (p: SVGProps<SVGSVGElement>) => ReactElement }[] = [
  { href: "/exchange/BTC", key: "exchange", label: "거래소", Icon: IconChart },
  { href: "/wallet", key: "wallet", label: "입출금", Icon: IconTransfer },
  { href: "/assets", key: "assets", label: "보유자산", Icon: IconAssets },
  { href: "/notice", key: "notice", label: "공지", Icon: IconBell },
  { href: "/more", key: "more", label: "더보기", Icon: IconMenu },
];
export default function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const active = (key: string) => (path.startsWith(`/${key}`) ? "on" : "");
  const portfolioHome = usePortfolioHome(PORTFOLIO_FALLBACK);
  return (
    <>
      <header className="topbar">
        <Link href="/exchange/BTC" className="logo">JC<span>Exchange</span></Link>
        <nav className="top-nav">
          <Link href="/exchange/BTC" className={active("exchange")}>거래소</Link>
          <Link href="/wallet" className={active("wallet")}>입출금</Link>
          <Link href="/assets" className={active("assets")}>보유자산</Link>
        </nav>
        {/* 복귀 링크는 다른 데모처럼 떠 있는 버튼이었는데, 이 앱만 화면을 조작요소로 꽉 채운다.
            position:fixed 는 뷰포트 어딘가의 버튼을 반드시 덮게 되고(1440 에서 "매수 주문",
            1280x720 에서 시장가/스탑/주문가격), 자리를 옮겨도 다른 폭에서 다시 덮는다.
            흐름 안으로 넣어 겹침이라는 가능성 자체를 없앤다 - 상단바는 sticky 라 계속 보인다. */}
        <div className="top-right">
          <a className="portfolio-home" href={portfolioHome} aria-label="포트폴리오 소개로 돌아가기">
            <span className="ph-ic" aria-hidden="true">&#8592;</span> 포트폴리오
          </a>
          <TabSyncBadge /><ThemeToggle /><span className="login-chip">로그인 (데모)</span>
        </div>
      </header>
      <div className="app-body">{children}</div>
      <nav className="bottom-tab">
        {TABS.map((t) => (
          <Link key={t.key} href={t.href} className={active(t.key)}>
            <t.Icon className="bt-icon" /><span className="bt-label">{t.label}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}

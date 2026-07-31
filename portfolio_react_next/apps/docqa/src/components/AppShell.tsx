'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { usePortfolioHome } from '@chat/ui';

// 서버 렌더/no-JS 용 기본값. 실제 목적지는 마운트 후 현재 호스트에서 조립한다 - 호스트가
// IP 에서 도메인으로 바뀌어도(그 반대도) 다시 빌드할 필요가 없다.
const PORTFOLIO_FALLBACK = process.env.NEXT_PUBLIC_PORTFOLIO_URL ?? '/';

/** 앱 공통 셸 - 상단바(브랜드·데모배지·내비·테마)와 포트폴리오 복귀 버튼. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isSearch = pathname.startsWith('/search');
  const isEval = pathname.startsWith('/eval');
  // 인트로 카드의 data-demo 와 같은 키. 이 앱은 화면마다 다른 카드라 라우트에서 고른다.
  // 품질 지표(/eval)는 카드가 아니라 목록 밖 링크 한 줄이다 - 키는 보내되 표식은 붙지 않는다.
  const demoKey = isEval ? 'docqa-eval' : isSearch ? 'docqa-search' : 'docqa-qa';
  const portfolioHome = usePortfolioHome(PORTFOLIO_FALLBACK, demoKey);

  const [theme, setTheme] = useState<'light' | 'dark' | null>(null);
  useEffect(() => {
    const cur = document.documentElement.dataset.theme;
    setTheme(cur === 'dark' ? 'dark' : 'light');
  }, []);
  function toggleTheme() {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('jc-docqa/theme', next);
    } catch {
      /* 저장 실패는 무시(프라이빗 모드 등) */
    }
    setTheme(next);
  }

  return (
    <>
      <header className="topbar">
        {/* 여섯 데모 중 이 앱만 화면에 소유자 표기가 없었다(브라우저 탭 제목에만 있었다).
            데모는 서브도메인으로 직접 열려서 인트로를 안 거친 평가자에게는 여기가 유일한
            자기소개 자리다. 푸터가 아니라 상단바에 두는 이유: §0 배지가 이미 여기 있어
            정체성 표기가 한 곳에 모이고, sticky 라 검색 결과가 길어져도 계속 보인다. */}
        <div className="brandBlock">
          <span className="brand">
            <span className="mark" aria-hidden="true">
              JC
            </span>
            DocuQA
            <span className="demoBadge">데모 · 더미데이터</span>
          </span>
          <span className="owner">
            최종은의 React + Next 포트폴리오
            <span className="ownerRole">Front-end 파트장 · Full-stack · IT 경력 12년+</span>
          </span>
        </div>
        <nav className="nav" aria-label="제품">
          <Link href="/" aria-current={!isSearch && !isEval ? 'page' : undefined}>
            근거 QA
          </Link>
          <Link href="/search" aria-current={isSearch ? 'page' : undefined}>
            시맨틱 검색
          </Link>
          <Link href="/eval" aria-current={isEval ? 'page' : undefined}>
            품질 지표
          </Link>
        </nav>
        <button
          type="button"
          className="themeToggle"
          onClick={toggleTheme}
          // 첫 페인트에는 현재 테마를 아직 모른다(하이드레이션 전). 모르는 상태를 아는 척하지 않는다.
          aria-label={
            theme === null
              ? '테마 전환'
              : theme === 'dark'
                ? '라이트 모드로 전환'
                : '다크 모드로 전환'
          }
        >
          <ThemeIcon dark={theme === 'dark'} />
        </button>
      </header>

      <main className="shell">{children}</main>

      <a className="portfolioHome" href={portfolioHome} aria-label="포트폴리오로 돌아가기">
        <span aria-hidden="true">&#8592;</span>
        <span className="label">포트폴리오</span>
      </a>
    </>
  );
}

function ThemeIcon({ dark }: { dark: boolean }) {
  // 라이트일 때 달(다크로 전환), 다크일 때 해(라이트로 전환)를 보이는 미니 라인 아이콘.
  return dark ? (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="4.5" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

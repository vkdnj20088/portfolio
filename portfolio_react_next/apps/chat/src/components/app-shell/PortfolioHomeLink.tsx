'use client';

import { usePortfolioHome } from '@chat/ui';

// 서버 렌더/no-JS 용 기본값. 실제 목적지는 마운트 후 현재 호스트에서 조립한다 - 호스트가
// IP 에서 도메인으로 바뀌어도(그 반대도) 다시 빌드할 필요가 없다.
const PORTFOLIO_FALLBACK = process.env.NEXT_PUBLIC_PORTFOLIO_URL ?? '/';

/**
 * 포트폴리오 복귀 버튼. AppShell 은 서버 컴포넌트라 훅을 쓸 수 없어서, 훅이 필요한
 * 이 링크 하나만 클라이언트 경계로 떼어냈다(셸 전체를 클라이언트로 만들면 사이드바까지
 * 딸려 들어간다).
 */
export function PortfolioHomeLink() {
  const href = usePortfolioHome(PORTFOLIO_FALLBACK);
  return (
    <a className="portfolio-home" href={href} aria-label="포트폴리오 소개로 돌아가기">
      <span className="ph-ic" aria-hidden="true">
        &#8592;
      </span>{' '}
      포트폴리오
    </a>
  );
}

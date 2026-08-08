import type { ReactNode } from 'react';
import { NetworkStatusBanner } from '@/components/network/NetworkStatusBanner';
import { Logo } from './Logo';
import { PortfolioHomeLink } from './PortfolioHomeLink';
import { ReplyModeNote } from './ReplyModeNote';
import { SidebarToggle } from './SidebarToggle';
import { ThemeToggle } from './ThemeToggle';
import styles from './AppShell.module.css';

interface AppShellProps {
  children: ReactNode;
  /** 사이드바 본문 슬롯. 채팅방 목록이 들어간다. */
  sidebar?: ReactNode;
}

/**
 * 전 페이지 공통 껍데기 - 좌측 사이드바(상단 로고 + 목록)와 본문 영역.
 *
 * 사이드바를 각 페이지가 아니라 이 셸이 소유한다. 채팅홈과 채팅방이 같은 목록을
 * 각자 렌더링하면 페이지를 오갈 때 목록이 언마운트/리마운트되면서 스크롤 위치와
 * 로딩 상태가 초기화된다. 셸에 두면 라우트가 바뀌어도 목록은 그대로 살아 있다.
 *
 * 접힘(STEP 13): html[data-sidebar='collapsed'] 이면 레일 폭으로 접힌다.
 * 접혀도 언마운트가 아니라 CSS 숨김이다 - 위의 "목록은 그대로 살아 있다"가
 * 접힘 상태에도 성립하고, 펼치면 스크롤/검색어가 그 자리에 있다.
 */
export function AppShell({ children, sidebar }: AppShellProps) {
  return (
    <div className={styles.root}>
      {/* 키보드 사용자가 사이드바(로고+방 목록 전체)를 Tab 으로 통과하지 않고
          본문으로 직행하는 통로. 포커스가 오기 전에는 시각적으로 숨겨져 있다. */}
      <a href="#main-content" className={styles.skipLink}>
        본문으로 건너뛰기
      </a>
      <NetworkStatusBanner />
      <div className={styles.shell}>
        {/* id 는 토글 버튼의 aria-controls 대상이다 */}
        <aside id="sidebar" className={styles.sidebar} aria-label="채팅방 목록">
          <div className={styles.sidebarHeader}>
            <span className={styles.sidebarLogo}>
              <Logo />
            </span>
            <SidebarToggle />
          </div>
          <div className={styles.sidebarBody}>{sidebar}</div>
          {/* 포트폴리오 식별 표기 - 모든 페이지에서 보이되 채팅 영역을 침범하지 않는 자리.
              여섯 데모 중 이 앱만 §0(실서비스 아님)을 화면에서 말하지 않고 있었다. 응답이
              결정적이라 같은 질문에 같은 답이 오는데, 그 사실이 안 적혀 있으면 의도한 목업이
              아니라 고장난 제품으로 읽힌다. 여기에 한 줄을 붙인다(사이드바를 접으면 이 줄도
              접히므로, 좁은 화면 첫 화면에는 랜딩에도 같은 사실을 둔다). */}
          {/* 귀속 줄이 스택("React + Next")만 말하고 있었다. 데모는 서브도메인으로 직접 열려서
              인트로를 안 거친 평가자에게는 이 줄이 유일한 자기소개인데, 스택 이름만으로는 만든
              사람의 역할과 경력이 읽히지 않는다. 인트로가 쓰는 표기를 그대로 가져온다.
              em 이 아니라 span 인 이유: 역할 표기는 강조가 아니라 부가 정보다. */}
          <div className={styles.sidebarFooter}>
            <span>
              최종은의 React + Next 포트폴리오
              <span className={styles.footerRole}>
                Front-end 파트장 · Full-stack · IT 경력 12년+
              </span>
              {/* 문구는 응답 모드에 따라 갈린다(LLM 전송 모드에서 "결정적 목업"은 거짓말) */}
              <ReplyModeNote className={styles.footerNote} />
            </span>
            <ThemeToggle />
          </div>
        </aside>
        {/* 본문 랜드마크 - 스킵 링크의 도착지. tabIndex=-1 은 앵커 이동 시 포커스가
            실제로 본문으로 옮겨지게 한다(없으면 스크롤만 되고 포커스는 링크에 남는다). */}
        <main id="main-content" tabIndex={-1} className={styles.main}>
          {children}
        </main>
      </div>
      <PortfolioHomeLink />
    </div>
  );
}

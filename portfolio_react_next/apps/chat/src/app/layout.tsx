import type { Metadata, Viewport } from 'next';
import { ToastProvider } from '@chat/ui';
import { AppShell } from '@/components/app-shell/AppShell';
import { ChatRoomList } from '@/components/sidebar/ChatRoomList';
import './globals.css';

// CSP nonce(middleware.ts)를 Next 가 스크립트 태그에 주입하려면 요청 시점 렌더가 필요하다.
// 정적(prerender) HTML 에는 per-request nonce 를 넣을 수 없어, script-src 의 'strict-dynamic' 이
// nonce 없는 청크를 전부 막는다(증상: 홈이 하이드레이션되지 않고 사이드바가 스켈레톤에 고착).
// 그래서 렌더를 동적으로 고정해 매 요청 nonce 가 스크립트에 실리게 한다.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'JC Chat - 최종은의 React + Next 포트폴리오 (AI 챗봇)',
  description: 'LLM 기반 채팅 서비스 데모 (최종은 포트폴리오, 실서비스 아님)',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  /* 추후 웹뷰 배포 시 노치 영역까지 배경이 차도록. CSS 의 env(safe-area-inset-*) 와 짝이다. */
  viewportFit: 'cover',
};

/**
 * 첫 페인트 전에 저장된 UI 선택을 html 속성으로 실체화한다(FOUC 방지).
 * 그려진 뒤 바뀌는 번쩍임을 막으려면 React 이전, 파서 시점에 돌아야 해서
 * 인라인 스크립트가 유일한 자리다. 값 부재는 환경에 맡긴다는 뜻이다 -
 * 테마(STEP 11)는 OS 선호로, 사이드바 접힘(STEP 13)은 화면 폭(좁으면 접힘)으로
 * 해석한다. 둘 다 CSS 는 속성 하나만 본다(data-theme / data-sidebar).
 */
const UI_STATE_INIT_SCRIPT = `(function () {
  try {
    var pref = localStorage.getItem('ai-chat/theme');
    var dark = pref === 'dark' ||
      (pref !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    var sidebar = localStorage.getItem('ai-chat/sidebar');
    if (sidebar === 'collapsed' ||
      (sidebar !== 'expanded' && window.matchMedia('(max-width: 640px)').matches)) {
      document.documentElement.dataset.sidebar = 'collapsed';
    }
  } catch (e) {
    document.documentElement.dataset.theme = 'light';
  }
})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    /* suppressHydrationWarning: data-theme/data-sidebar 는 위 스크립트가 클라이언트에서
       결정하므로 서버 마크업과 의도적으로 다르다 - html 요소 한정 억제라 다른
       불일치는 여전히 잡힌다. */
    <html lang="ko" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: UI_STATE_INIT_SCRIPT }} />
        {/* ToastProvider: 사이드바(삭제/수정)와 본문(피드백/재생성/복사)의 알림이 한 polite
            라이브 리전을 공유한다(window.alert 대체). */}
        <ToastProvider>
          {/* 사이드바(채팅방 목록)는 레이아웃 소유 - 홈<->채팅방 이동에도 마운트가 유지된다 */}
          <AppShell sidebar={<ChatRoomList />}>{children}</AppShell>
        </ToastProvider>
      </body>
    </html>
  );
}

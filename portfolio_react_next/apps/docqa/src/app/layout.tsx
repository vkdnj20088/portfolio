import type { Metadata } from 'next';
import { THEME_INIT } from '@/lib/themeInit';
import './globals.css';

// per-request nonce 를 스크립트에 실으려면 요청 시점 렌더가 필요하다(정적 프리렌더 아님).
export const dynamic = 'force-dynamic';

// 라우트마다 제목이 달라야 클라이언트 내비게이션 시 Next 의 route announcer 가 페이지 전환을
// 스크린리더에 알린다(제목이 같으면 아무것도 알리지 않는다). 하위 라우트는 자체 layout 에서 덮어쓴다.
export const metadata: Metadata = {
  title: '문서 근거 QA - JC DocuQA (최종은 포트폴리오)',
  description:
    '사내 문서에서 근거 문장을 그대로 인용해 답하는 문서 QA(검색 + 추출형 MRC)와 시맨틱 검색 데모. 실서비스 아님 · 더미 데이터.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

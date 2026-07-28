import type { Metadata } from 'next';

// 라우트별 제목(전환 알림용). 검색 화면은 클라이언트 컴포넌트라 metadata 를 스스로 내보낼 수 없다.
export const metadata: Metadata = {
  title: '시맨틱 검색 - JC DocuQA (최종은 포트폴리오)',
};

export default function SearchLayout({ children }: { children: React.ReactNode }) {
  return children;
}

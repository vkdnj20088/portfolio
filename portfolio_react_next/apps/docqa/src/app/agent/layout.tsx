import type { Metadata } from 'next';

// 라우트별 제목은 layout 에서 낸다(다른 라우트와 같은 이유 - eval/layout.tsx 주석 참조).
export const metadata: Metadata = {
  title: '에이전트 실행 되짚기 - JC DocuQA (최종은 포트폴리오)',
  description:
    '도구를 쓰는 에이전트의 실행을 span 트리로 남기고, 성공한 실행과 실패한 실행을 같은 방식으로 되짚습니다. 모델 응답은 커밋된 것을 재생하고 도구는 지금 다시 실행해 대조합니다.',
};

export default function AgentLayout({ children }: { children: React.ReactNode }) {
  return children;
}

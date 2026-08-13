import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '무엇이 막는가 - JC DocuQA (최종은 포트폴리오)',
  description:
    '사용자가 제출한 문서에 심긴 지시가 부작용 도구를 부르려 할 때 무엇이 막는지, 가드를 끄고 켠 같은 실행을 나란히 놓고 봅니다.',
};

export default function AgentGuardLayout({ children }: { children: React.ReactNode }) {
  return children;
}

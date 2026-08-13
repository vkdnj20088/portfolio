import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '회귀인가 잡음인가 - JC DocuQA (최종은 포트폴리오)',
  description:
    '같은 과제를 구성 두 종으로 세 번씩 돌려, 통과율 차이가 잡음과 구분되는지 쌍대 정확검정과 부트스트랩 구간으로 판정합니다. 이 규모가 못 보는 차이의 크기도 함께 적습니다.',
};

export default function AgentEvalLayout({ children }: { children: React.ReactNode }) {
  return children;
}

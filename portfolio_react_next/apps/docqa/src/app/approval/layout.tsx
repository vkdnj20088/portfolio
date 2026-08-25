import type { Metadata } from 'next';

// 라우트별 제목은 layout 에서 낸다(다른 라우트와 같은 이유 - eval/layout.tsx 주석 참조).
export const metadata: Metadata = {
  title: '이중 승인 실험대 - JC DocuQA (최종은 포트폴리오)',
  description:
    '외부 결제 승인이 timeout 일 때 그것은 실패가 아니라 모름입니다. 성공/실패 2 값으로 접으면 어느 쪽으로 접어도 틀린다는 것을, 방어선을 끄고 켠 같은 실행을 나란히 돌려 숫자로 보입니다.',
};

export default function ApprovalLayout({ children }: { children: React.ReactNode }) {
  return children;
}

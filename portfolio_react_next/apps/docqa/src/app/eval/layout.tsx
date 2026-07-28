import type { Metadata } from 'next';

// 라우트별 제목은 layout 에서 낸다. page 에서 내보내면 스트리밍 SSR 에서 메타가 셸보다 늦게 실려,
// 크롤러·감사 도구가 초기 head 만 읽고 "설명 없음"으로 보는 경우가 있다(라이트하우스 SEO 90).
export const metadata: Metadata = {
  title: '품질 지표 - JC DocuQA (최종은 포트폴리오)',
  description:
    '골드셋 33문항으로 잰 검색 Recall@k·MRR, 추출형 답변 정확도, 불응답 정확도. 오답과 과잉 불응답까지 함께 공개합니다.',
};

export default function EvalLayout({ children }: { children: React.ReactNode }) {
  return children;
}

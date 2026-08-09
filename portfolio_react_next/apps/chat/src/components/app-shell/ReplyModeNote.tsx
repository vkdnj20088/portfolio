'use client';

import { useReplyMode } from '@/hooks/useReplyMode';

/**
 * 사이드바 푸터의 §0 표기. "응답은 결정적 목업"은 무키(배포)에서만 참인 문장이라,
 * LLM 전송 모드(로컬 키)에서는 거짓말이 되기 전에 문구를 바꾼다. AppShell 은 서버
 * 컴포넌트로 남기고 이 한 조각만 클라이언트로 내려 모드를 조회한다.
 */
/** 모드별 §0 한 줄. sampled 는 "재생"임을 명시한다 - 실시간 호출로 읽히면 그것도 거짓말이다. */
const NOTE: Record<string, string> = {
  llm: '실서비스 아님 · 응답은 실제 LLM(로컬 키 실행)',
  sampled: '실서비스 아님 · 추천 질문은 실제 LLM 응답 재생, 그 외는 결정적 목업',
  mock: '실서비스 아님 · 응답은 결정적 목업',
};

export function ReplyModeNote({ className }: { className?: string }) {
  const mode = useReplyMode();
  return <em className={className}>{NOTE[mode] ?? NOTE.mock}</em>;
}

'use client';

import { useEffect, useState } from 'react';

/**
 * 응답 생성의 실체.
 *   mock    결정적 목업(pickReply)
 *   sampled 추천 질문은 **커밋된 실제 LLM 응답** 재생, 그 밖은 목업(무키 배포의 기본)
 *   llm     실제 LLM 실시간 호출(서버 로컬 키)
 */
export type ReplyMode = 'mock' | 'sampled' | 'llm';

/**
 * 화면이 §0 문구("응답은 결정적 목업")를 말하기 전에 그 문장이 참인지 확인하는 훅.
 *
 * LLM 모드 여부는 서버 런타임 환경(ANTHROPIC_API_KEY)에 달려 있어 빌드 산출물이나
 * 클라이언트 번들로는 알 수 없다 - GET /api/reply 로 물어본다. 기본값은 mock 이다:
 * 배포(무키·SSE)와 로컬 기본(mock 전송) 모두에서 참인 문장이고, LLM 모드에서도 첫
 * 페인트 한 순간만 보수적으로 표기했다가 응답이 오면 바뀐다.
 *
 * 전송이 mock(in-process)이면 서버에 묻지 않는다 - 서버에 키가 있어도 응답은 mock 이
 * 만들므로 문구는 목업이 맞다.
 */
export function useReplyMode(): ReplyMode {
  const [mode, setMode] = useState<ReplyMode>('mock');

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_TRANSPORT !== 'sse') return;
    const controller = new AbortController();
    fetch('/api/reply', { method: 'GET', signal: controller.signal })
      .then((res) => (res.ok ? (res.json() as Promise<{ mode?: unknown }>) : null))
      .then((data) => {
        if (data?.mode === 'llm' || data?.mode === 'sampled') setMode(data.mode);
      })
      .catch(() => {
        // 조회 실패는 표기를 바꾸지 않는다 - 기본(목업)이 안전한 쪽이다.
      });
    return () => controller.abort();
  }, []);

  return mode;
}

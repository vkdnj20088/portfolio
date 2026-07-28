'use client';

import { useEffect } from 'react';

/**
 * 마운트 동안 document.title 을 바꾸고, 언마운트 시 이전 값으로 되돌린다.
 *
 * 채팅방처럼 제목이 클라이언트 데이터(localStorage mock)에서 오는 화면은
 * 서버 generateMetadata 로는 제목을 만들 수 없다 - 서버는 그 데이터를 읽지
 * 못하기 때문이다. 그래서 클라이언트에서 갱신한다. 탭이 여러 개일 때 어느
 * 탭이 어느 방인지, 히스토리 목록에서 어떤 기록인지 구분되게 하는 것이 목적.
 */
export function useDocumentTitle(title: string | null) {
  useEffect(() => {
    if (!title) return;
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);
}

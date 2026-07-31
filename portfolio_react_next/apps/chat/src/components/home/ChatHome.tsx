'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { chatApi } from '@/lib/api/chatApi';
import { refreshRooms } from '@/lib/chat-store/roomsStore';
import { clearHomeDraft, readHomeDraft, saveHomeDraft, setPendingMessage } from '@/lib/draft';
import { MessageComposer } from '@/components/composer/MessageComposer';
import { LogoMark } from '@/components/app-shell/LogoMark';
import styles from './ChatHome.module.css';

/**
 * 채팅 홈(/)의 본문.
 *
 * 전송 흐름은 명세("진입 시 입력한 내용으로 즉시 전송")대로 홈이 아니라 채팅방이
 * 전송 주체다. 홈의 역할은 방 생성, pending 메시지 핸드오프, 이동 - 셋뿐이다.
 * 그래서 hard navigation 이 끼어들어도 흐름이 깨지지 않는다 - 입력값과 pending 이
 * 모두 sessionStorage 에 있기 때문이다.
 */
/**
 * 추천 질문 칩(STEP 10) - 클릭 한 번으로 생성 -> 이동 -> 진입 즉시 전송 -> 2초 응답 ->
 * 페이드 인까지 핵심 흐름 전체가 재생된다. 뒤의 두 칩은 결정적 트리거를 담아
 * 응답 실패(/error)와 delta 스트리밍(/stream, STEP 12)도 원클릭으로 재현된다.
 *
 * 앞의 세 칩은 서로 다른 주제(테스트/네이밍/성능)의 키워드를 담는다(STEP 15) -
 * 세 번 눌러 보면 mock 이 입력을 읽는다는 사실이 문서 없이 드러난다. 칩은 매번 새
 * 방을 만들고 응답 일련번호는 방별이라, 어느 칩을 눌러도 그 주제의 첫 문안이 온다.
 */
const SUGGESTIONS = [
  '테스트 코드는 어디부터 짜야 할까?',
  '좋은 변수명을 짓는 기준이 뭘까?',
  '화면이 느려졌는데 어디부터 봐야 할까?',
  '응답 실패 흐름 재현 (/error)',
  '스트리밍 응답 미리보기 (/stream)',
];

export function ChatHome() {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 드래프트 복원. SSR 마크업과의 불일치를 피하려고 초기값('')로 그린 뒤 마운트 후 채운다.
  useEffect(() => {
    const saved = readHomeDraft();
    if (saved) setValue(saved);
  }, []);

  function handleChange(next: string) {
    setValue(next);
    saveHomeDraft(next); // 타이핑 즉시 영속 - 새로고침/하드 내비게이션 생존
  }

  async function handleSubmit(content: string) {
    setSubmitting(true);
    setError(null);
    try {
      // 제목 파생(공백 접기/30자)은 API 가 한다 - 여기서 미리 파생하면 규칙의 진실원이 둘이 된다
      const room = await chatApi.createChatRoom({ title: content });
      setPendingMessage(room.id, content); // 채팅방이 진입 직후 소비해 즉시 전송한다
      clearHomeDraft(); // 성공했을 때만 비운다 - 실패 시 입력은 남아야 한다
      void refreshRooms();
      router.push(`/c/${room.id}`);
    } catch {
      setError('채팅방을 만들지 못했습니다. 네트워크 상태를 확인하고 다시 시도해 주세요.');
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.home}>
      <div className={styles.inner}>
        {/* 일반적인 채팅 홈의 구성(중앙 로고 마크 + 입력창)을 따른다 - 장식이라 보조기술에는 숨긴다 */}
        <span className={styles.brandMark} aria-hidden="true">
          <LogoMark size={34} />
        </span>
        <h1 className={styles.greeting}>무엇이든 물어보세요</h1>
        {/* 인사말만 있으면 실제 LLM 을 기대하게 되고, 그러면 같은 답이 반복되는 것이 결함으로
            읽힌다. 결정적 목업이라는 사실과 무엇을 눌러 볼지를 한 줄로 둔다(사이드바 §0 은
            좁은 화면에서 레일로 접혀 안 보이므로, 첫 화면에는 이 줄이 그 역할을 겸한다). */}
        <p className={styles.demoNote}>
          실 LLM 없이 도는 목업이라 같은 질문에는 같은 답이 옵니다. 아래 칩으로 스트리밍과 실패·재시도 흐름을 그대로 재현할 수 있습니다.
        </p>
        <MessageComposer
          value={value}
          onChange={handleChange}
          onSubmit={(content) => void handleSubmit(content)}
          disabled={submitting}
          autoFocus
        />
        <div className={styles.chips} role="group" aria-label="추천 질문">
          {SUGGESTIONS.map((text) => (
            <button
              key={text}
              type="button"
              className={styles.chip}
              disabled={submitting}
              onClick={() => void handleSubmit(text)}
            >
              {text}
            </button>
          ))}
        </div>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

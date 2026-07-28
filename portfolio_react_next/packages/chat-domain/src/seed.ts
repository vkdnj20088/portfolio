import type { ChatRoom, Message } from './types';
import { createId } from './ids';

export interface ChatState {
  rooms: ChatRoom[];
  /** chatId -> 시간 오름차순 메시지 배열 */
  messages: Record<string, Message[]>;
  /** chatId -> 확정된 응답 수. 응답 문안 선택의 지표(STEP 15). 구버전 저장 값에는 없다. */
  replySeq?: Record<string, number>;
}

const MINUTE = 60_000;

function textMessage(
  chatId: string,
  role: Message['role'],
  text: string,
  createdAt: number,
): Message {
  return { id: createId('msg'), chatId, role, parts: [{ type: 'text', text }], createdAt };
}

/**
 * 첫 실행용 시드.
 *
 * 방 3개를 의도적으로 다르게 만든다:
 *  - "짧은 방": 일반적인 대화 흐름 확인용.
 *  - "긴 방"(130개): 4단계의 50개 페이지네이션과 스크롤 최상단 로드를
 *    별도 데이터 조작 없이 바로 시연하기 위한 데이터. 페이지 경계(50/50/30)가
 *    한눈에 보이도록 각 메시지에 번호를 박아 둔다.
 *  - "공지 방"(receive-only): 개요가 예고한 알림톡형 방 유형이 스키마 장식이
 *    아니라 UI 까지 관통함을 시연한다 - 입력 폼 대신 안내가 뜨고 전송이 거부된다.
 *    마지막 대화가 가장 오래돼 목록 최하단에 앉는다(다른 데모를 가리지 않게).
 */
export function createSeedState(now: number): ChatState {
  const short: ChatRoom = {
    id: createId('chat'),
    title: '프로젝트 아이디어 브레인스토밍',
    type: 'default',
    createdAt: now - 90 * MINUTE,
    updatedAt: now - 4 * MINUTE,
  };

  const long: ChatRoom = {
    id: createId('chat'),
    title: '긴 대화 - 페이지네이션 데모 (130개)',
    type: 'default',
    createdAt: now - 60 * 24 * MINUTE,
    updatedAt: now - 30 * MINUTE,
  };

  const shortConversation: Array<[Message['role'], string]> = [
    ['user', '사이드 프로젝트 아이디어 좀 같이 정리해 줄래?'],
    ['assistant', '좋아요. 어떤 분야에 관심이 있으신가요? 최근에 자주 쓰는 서비스에서 불편했던 점부터 출발하면 좋습니다.'],
    ['user', '팀 회고를 기록하는 도구가 마땅치 않아. 노션은 너무 자유도가 높고.'],
    ['assistant', '구조화된 회고 도구라는 방향이 좋네요. 템플릿 고정 + 액션 아이템 추적, 두 가지가 핵심 기능이 될 수 있습니다.'],
    ['user', '액션 아이템 추적을 조금 더 구체화해 줘.'],
    ['assistant', '회고에서 나온 액션에 담당자와 기한을 붙이고, 다음 회고 시작 시 지난 액션의 완료 여부를 먼저 확인하는 흐름을 제안합니다. 완료율이 팀 지표가 됩니다.'],
    ['user', '좋다. MVP 범위는 어떻게 잡을까?'],
    ['assistant', 'MVP 는 회고 작성(고정 템플릿), 액션 아이템 등록, 다음 회고에서의 리뷰 세 가지로 좁히는 것을 추천합니다. 알림이나 통계는 그 다음입니다.'],
  ];
  const shortMessages: Message[] = shortConversation.map(([role, text], index) =>
    textMessage(short.id, role, text, now - (90 - index * 10) * MINUTE),
  );
  // parts 유니온 확장 실증(STEP 12) - 'code' 조각이 붙은 메시지. 렌더러 스위치에
  // 케이스 하나가 늘었을 뿐 목록/스크롤/복사(요약 텍스트) 계층은 그대로다.
  shortMessages.push(
    textMessage(short.id, 'user', '마지막으로, 회고 템플릿을 코드로 정리해 줄 수 있어?', now - 12 * MINUTE),
    {
      id: createId('msg'),
      chatId: short.id,
      role: 'assistant',
      parts: [
        { type: 'text', text: '물론이죠. 액션 아이템 추적까지 담으면 이런 모양입니다.' },
        {
          type: 'code',
          language: 'typescript',
          text: 'interface Retrospective {\n  keep: string[];\n  problem: string[];\n  try: Action[];\n}\n\ninterface Action {\n  owner: string;\n  due: string; // YYYY-MM-DD\n  done: boolean;\n}',
        },
      ],
      createdAt: now - 4 * MINUTE,
    },
  );

  const longMessages: Message[] = [];
  for (let i = 1; i <= 130; i++) {
    const role = i % 2 === 1 ? 'user' : 'assistant';
    const text =
      role === 'user'
        ? `${i}번째 질문입니다. 페이지네이션 경계가 잘 동작하는지 확인하는 메시지예요.`
        : `${i}번째 응답입니다. 이 방은 50개 단위 페이지네이션 데모용이라 메시지에 번호를 박아 두었습니다.`;
    longMessages.push(
      textMessage(long.id, role, text, now - (130 - i) * 15 * MINUTE),
    );
  }

  const notice: ChatRoom = {
    id: createId('chat'),
    title: '공지사항',
    type: 'receive-only',
    createdAt: now - 7 * 24 * 60 * MINUTE,
    updatedAt: now - 2 * 24 * 60 * MINUTE,
  };
  const noticeMessages: Message[] = [
    textMessage(
      notice.id,
      'assistant',
      '안녕하세요, AI 채팅에 오신 것을 환영합니다. 이 방은 받은 메시지 전용(알림톡형)이라 답장을 보낼 수 없습니다.',
      now - 7 * 24 * 60 * MINUTE,
    ),
    textMessage(
      notice.id,
      'assistant',
      '메시지에 /error 를 포함해 보내면 응답 실패와 재시도 흐름을 재현할 수 있습니다. 네트워크를 오프라인으로 바꾸면 상단 배너와 요청 실패도 함께 확인됩니다.',
      now - 2 * 24 * 60 * MINUTE,
    ),
  ];

  return {
    rooms: [short, long, notice],
    messages: {
      [short.id]: shortMessages,
      [long.id]: longMessages,
      [notice.id]: noticeMessages,
    },
  };
}

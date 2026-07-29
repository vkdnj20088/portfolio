import {
  ChatApiError,
  deriveRoomTitle,
  messageText,
  type ChatRoom,
  type ChatRoomSummary,
  type ChatRoomType,
  type Message,
  type MessagePage,
  type MessageRating,
  type MessageSearchHit,
  type ReplyEvent,
} from './types';
import { createId } from './ids';
import { createDefaultStorage, type KVStorage } from './storage';
import { createMessageSearcher } from './messageSearch';
import { createSeedState, type ChatState } from './seed';

/**
 * 클라이언트 Mock API.
 *
 * 이 데모는 "클라이언트 Mock API" 를 전제하므로 서버(route handler)가 아니라
 * 브라우저 안에서 동작한다. localStorage 로 영속해 새로고침/hard navigation 후에도
 * 데이터가 유지된다.
 *
 * 실제 네트워크처럼 보이게 하는 장치와, 일부러 넣지 않은 것:
 *  - 모든 호출에 지연을 건다(읽기 150ms / 쓰기 250ms / 응답 2000ms - 명세값).
 *  - 오프라인이면 실패시킨다. 데브툴 Network -> Offline 로 에러 상태를 재현할 수 있고,
 *    네트워크 배너와 mock 의 동작이 서로 모순되지 않는다.
 *  - 응답 오류는 결정적 트리거(메시지에 "/error" 포함)로만 재현한다.
 *    무작위 실패는 넣지 않았다 - 평가 중 우연히 터지면 기능 버그처럼 보인다.
 *
 * storage / isOnline / now 를 주입받는 이유: 테스트가 브라우저 없이 결정적으로 돈다.
 * 기본값은 브라우저 환경(localStorage / navigator.onLine / Date.now)이다.
 */

export interface MockChatApiDelays {
  read: number;
  write: number;
  reply: number;
}

export interface MockChatApiOptions {
  storage?: KVStorage;
  isOnline?: () => boolean;
  now?: () => number;
  delays?: Partial<MockChatApiDelays>;
  /** 저장소가 비어 있을 때 시드 데이터를 넣을지. 기본 true. */
  seed?: boolean;
}

/** 응답 2000ms 는 명세값("메시지 전송 후 2초"). 나머지는 체감용 상수다. */
const DEFAULT_DELAYS: MockChatApiDelays = { read: 150, write: 250, reply: 2000 };

const STORAGE_KEY = 'ai-chat/v1';

/**
 * 페이지네이션 커서. 메시지 id 단독이 아니라 (createdAt, id) 합성으로 인코딩한다.
 *
 * id 만으로 잡으면 다른 탭이 그 "경계 메시지" 를 삭제했을 때 커서가 가리키는 대상이 사라져
 * 이후 loadOlder 가 영구히 실패한다(재시도가 같은 죽은 커서를 재사용). 시간값 기준 위치는
 * 경계 메시지의 존재 여부와 무관하게 성립하므로 삭제를 견딘다. id 는 동시각(createdAt 동률)
 * 의 결정적 타이브레이커이며, 이 서비스의 시각은 사실상 유일해 대개 관여하지 않는다.
 */
function encodeCursor(message: Message): string {
  return `${message.createdAt}:${message.id}`;
}

function parseCursor(raw: string): { createdAt: number; id: string } | null {
  const sep = raw.indexOf(':');
  if (sep < 0) return null;
  const createdAt = Number(raw.slice(0, sep));
  const id = raw.slice(sep + 1);
  if (!Number.isFinite(createdAt) || id === '') return null;
  return { createdAt, id };
}

/** 시간 오름차순(동률이면 id 사전순)에서 message 가 cursor 보다 엄격히 이전인가. */
function isBeforeCursor(message: Message, cursor: { createdAt: number; id: string }): boolean {
  if (message.createdAt !== cursor.createdAt) return message.createdAt < cursor.createdAt;
  return message.id < cursor.id;
}

/**
 * 응답 mock 문안 100종 - 입력을 읽는 결정적 선택(STEP 15).
 *
 * 마지막 사용자 메시지에서 주제 키워드를 찾아(테이블 순서 첫 일치) 그 주제의
 * 문안을, 없으면 일반 문안을 돌려준다. 선택 인덱스는 방별 응답 일련번호의
 * 순환이다. 무작위를 쓰지 않는 이유는 무작위 실패를 배제한 이유와 같다 -
 * 같은 조작은 같은 화면을 내야 한다. (입력, 일련번호) -> 문안의 순수 함수라
 * 재현이 그대로 서고, 순환은 연속 중복도 구조적으로 없다.
 *
 * 키워드는 소문자 부분 문자열 매칭이다. 명사는 조사가 붙어도('테스트를') 어간
 * 음절이 보존되어 걸리므로 형태소 분석 없이 충분하고, 활용으로 음절이 변하는
 * 용언만 형태를 나열한다('느려/느리'). 문장은 5단계 페이드인 데모에 맞춰 2~3문장이다.
 */
interface ReplyTopic {
  keywords: string[];
  replies: string[];
}

/** 주제 21종 × 4문안. 배열 순서가 우선순위다 - 키워드가 겹치면 앞 주제가 이긴다
    (예: "에러 상태"는 뒤의 '상태'가 아니라 앞의 '에러'로, "타입 버전"은 '버전'으로 간다). */
const REPLY_TOPICS: ReplyTopic[] = [
  {
    keywords: ['안녕', '반가', '반갑', 'hello'],
    replies: [
      '안녕하세요. 무엇을 도와드릴까요? 지금 막힌 지점이나 고민 중인 주제를 그대로 적어 주시면 거기서부터 시작하겠습니다.',
      '반갑습니다. 코드 리뷰든 설계 고민이든 편하게 꺼내 주세요. 문제 상황을 한두 문장으로 요약해 주시면 더 정확한 답을 드릴 수 있어요.',
      '네, 안녕하세요. 언제든 환영입니다. 구체적인 코드나 에러 메시지를 함께 주시면 답의 해상도가 올라갑니다.',
      '안녕하세요, 좋은 하루 보내고 계신가요? 개발하다 궁금해진 것들을 하나씩 물어봐 주시면 차근차근 같이 정리해 보겠습니다.',
    ],
  },
  {
    keywords: ['테스트', '커버리지', 'tdd'],
    replies: [
      '테스트는 개수보다 위치가 중요합니다. 버그가 났을 때 가장 아픈 경로, 자주 바뀌는 규칙부터 고정하세요. 커버리지 숫자는 그다음입니다.',
      '깨지기 쉬운 테스트는 구현을 검증하고 있을 가능성이 큽니다. 내부 호출 순서가 아니라 입력과 출력, 즉 계약을 검증하면 리팩토링에도 살아남는 테스트가 됩니다.',
      '테스트가 어렵게 느껴지는 코드는 대개 설계가 먼저 어려운 코드입니다. 의존성을 주입 가능하게 바꾸는 것만으로 테스트와 설계가 함께 좋아지는 경우가 많아요.',
      '실패하는 테스트를 먼저 쓰는 습관은 요구사항을 코드보다 먼저 정의하게 만듭니다. 전부 그렇게 갈 필요는 없지만, 버그 수정만큼은 재현 테스트부터 쓰는 것을 권합니다.',
    ],
  },
  {
    keywords: ['네이밍', '변수명', '함수명', '이름'],
    replies: [
      '이름 짓기에 시간을 쓰는 것은 낭비가 아닙니다. 이름이 어색하다면 대개 경계를 잘못 그은 신호예요. 이름을 고치다 보면 구조의 문제가 먼저 드러납니다.',
      '좋은 이름의 기준은 부르는 쪽입니다. 호출부에서 읽었을 때 주석 없이 의도가 통하면 좋은 이름이고, 정의를 열어봐야 이해되면 다시 지을 이름입니다.',
      '축약은 이름을 짧게 만들지만 검색을 어렵게 만듭니다. 도메인 용어는 팀 사전에 있는 그대로, 풀어서 쓰는 편이 반년 뒤의 검색을 살립니다.',
      '불리언 이름은 참일 때의 의미가 문장으로 읽히게 지으세요. is, has, can 으로 시작하고 부정형을 피하는 것만으로 조건문의 절반이 읽기 쉬워집니다.',
    ],
  },
  {
    keywords: ['리뷰', '머지', '승인'],
    replies: [
      '코드 리뷰에서는 정답을 지시하기보다 질문을 남겨 보세요. 왜 이 방식을 택했는지 물으면, 작성자가 스스로 더 나은 답을 찾는 경우가 많습니다.',
      '리뷰가 오래 걸린다면 변경이 너무 큰 경우가 대부분입니다. 리뷰어의 집중력은 수백 줄에서 끝나요. 작게 나눠 올리는 것이 리뷰 품질을 올리는 가장 확실한 방법입니다.',
      '리뷰 코멘트에는 온도를 표시해 보세요. 반드시 고쳐야 하는 것과 취향 제안을 구분해 주면, 작성자는 우선순위를 알고 리뷰어는 오해를 줄입니다.',
      '머지 전 확인은 사람의 기억보다 자동화가 낫습니다. 린트, 테스트, 타입 검사를 통과해야 합칠 수 있게 해 두면 리뷰는 설계 논의에 집중할 수 있습니다.',
    ],
  },
  {
    keywords: ['디버깅', '디버그', '버그', '재현'],
    replies: [
      '디버깅의 절반은 재현입니다. 재현 절차를 먼저 고정하고, 이분법으로 범위를 좁히세요. 짐작으로 고친 버그는 대개 다른 얼굴로 돌아옵니다.',
      '가장 최근에 바꾼 것부터 의심하세요. 어제까지 되던 것이 오늘 안 된다면 원인은 대부분 그 사이의 변경에 있습니다. 이력을 반씩 좁혀 가면 범인은 빨리 나옵니다.',
      '버그가 사라졌다고 끝난 것이 아닙니다. 왜 생겼고 왜 그 수정으로 사라졌는지 설명할 수 없다면, 같은 버그가 자리만 옮겨 살아 있을 확률이 높아요.',
      '이상한 버그일수록 가정을 적어 보세요. 확실하다고 믿는 것 중 하나가 틀렸을 때 버그는 이상해 보입니다. 가정을 하나씩 검증하면 미스터리는 평범한 실수가 됩니다.',
    ],
  },
  {
    keywords: ['에러', '오류', '예외'],
    replies: [
      '에러 메시지는 미래의 나에게 보내는 편지입니다. 무엇이 실패했는지와 함께, 사용자가 다음에 무엇을 하면 되는지까지 적어야 완성이에요.',
      '모든 예외를 잡는 코드는 아무 예외도 처리하지 않는 코드와 비슷해집니다. 복구할 수 있는 지점에서만 잡고, 복구할 수 없다면 맥락을 더해 위로 올려 보내세요.',
      '실패 경로도 설계의 일부입니다. 성공 흐름을 그린 다음 각 단계가 실패하면 사용자가 무엇을 보게 되는지 함께 그리세요. 빈 화면과 무한 로딩은 대부분 그 그림이 없어서 생깁니다.',
      '에러를 삼키는 코드는 당장의 평화와 미래의 미스터리를 교환합니다. 최소한 기록이라도 남기고, 침묵이 의도라면 왜 침묵해도 되는지 주석으로 적어 두세요.',
    ],
  },
  {
    keywords: ['성능', '최적화', '느려', '느리', '병목', '렌더링'],
    replies: [
      '느리다고 느껴지면 먼저 측정하세요. 병목은 예상과 다른 곳에 있는 경우가 대부분이고, 측정 없이 고친 최적화는 코드만 복잡하게 만들 때가 많습니다.',
      '렌더링 성능은 횟수보다 낭비를 보세요. 같은 입력으로 같은 결과를 다시 그리고 있다면 그 지점이 메모이제이션의 자리입니다. 다만 측정 없이 붙인 캐시는 오히려 비용이 될 수 있어요.',
      '체감 성능은 총 소요 시간보다 첫 반응까지의 시간이 좌우합니다. 뼈대 화면이나 낙관적 갱신으로 먼저 반응을 보여 주면 같은 작업도 훨씬 빠르게 느껴집니다.',
      '최적화 전후의 수치를 같은 조건에서 기록해 두세요. 숫자가 없으면 개선은 주장에 그치고, 회귀가 생겨도 알아차릴 수 없습니다.',
    ],
  },
  {
    keywords: ['리팩토링', '리팩터링'],
    replies: [
      '리팩토링은 큰맘 먹고 하는 행사가 아니라 기능을 만들며 지나가는 자리를 정돈하는 습관에 가깝습니다. 보이스카우트 규칙 정도의 크기가 오래갑니다.',
      '동작 변경과 구조 변경을 한 번에 섞지 마세요. 리팩토링은 동작이 같음을 테스트로 보장할 때 리뷰어가 안심하고 빠르게 승인할 수 있습니다.',
      '리팩토링의 우선순위는 자주 바뀌는 곳입니다. 다시 열지 않을 코드를 다듬는 것보다 다음 기능이 지나갈 길을 넓히는 쪽이 투자 대비 효과가 큽니다.',
      '큰 리팩토링일수록 되돌릴 수 있는 걸음으로 자르세요. 중간 상태에서도 빌드와 테스트가 통과해야, 급한 일이 끼어들어도 작업을 안전하게 멈출 수 있습니다.',
    ],
  },
  {
    keywords: ['상태', '스토어', '전역'],
    replies: [
      '상태가 늘어날수록 파생 값의 유혹도 커집니다. 저장하는 상태는 최소로 두고 나머지는 계산하세요. 동기화 버그의 절반은 같은 사실을 두 곳에 적어서 생깁니다.',
      '전역 상태는 편리한 만큼 결합을 만듭니다. 화면 하나에서만 쓰는 상태는 그 화면에 두세요. 끌어올리는 것은 두 번째 사용처가 생겼을 때 해도 늦지 않습니다.',
      '서버에서 온 데이터와 화면의 임시 상태는 수명이 다릅니다. 이 둘을 한곳에 섞으면 무효화와 초기화 타이밍이 꼬이기 시작해요. 출처가 다르면 두는 곳도 나누는 편이 낫습니다.',
      '상태 갱신이 예측 불가능하게 느껴지면 흐름을 한 방향으로 정리해 보세요. 어디서든 바꿀 수 있는 상태는 어디서 바뀌었는지 아무도 모르는 상태가 됩니다.',
    ],
  },
  {
    keywords: ['api', '엔드포인트', '페이지네이션'],
    replies: [
      'API 는 만드는 쪽이 아니라 쓰는 쪽 입장에서 설계하세요. 호출 코드를 먼저 써 보면 인터페이스의 어색함이 구현 전에 드러납니다.',
      '페이지네이션은 처음부터 커서 방식을 고려해 보세요. 오프셋은 단순하지만 목록이 실시간으로 자라면 중복과 누락이 생깁니다.',
      '응답 스키마의 필드 하나하나가 전부 약속입니다. 한번 내보낸 필드는 지우기 어려우니, 확신이 없는 값은 처음부터 내보내지 않는 쪽이 안전합니다.',
      '실패 응답에도 스키마를 정하세요. 에러 코드와 사람이 읽을 메시지를 구조로 약속해 두면, 클라이언트는 분기하고 사용자는 이해할 수 있습니다.',
    ],
  },
  {
    keywords: ['의존성', '라이브러리', '패키지', '버전'],
    replies: [
      '의존성을 고를 때는 스타 수보다 유지보수 이력과 지원 범위를 보세요. 우리 지원 창을 벗어나는 라이브러리는 아무리 훌륭해도 우리 것이 아닙니다.',
      '의존성 하나를 들이는 것은 코드와 함께 그 프로젝트의 릴리스 주기와 보안 이슈까지 들이는 일입니다. 직접 쓰면 스무 줄인 기능이라면 직접 쓰는 쪽을 먼저 고려해 보세요.',
      '버전 업그레이드는 미룰수록 비싸집니다. 조금씩 자주 올리면 변경 기록을 읽는 일이지만, 몇 년 치를 한번에 올리면 고고학이 됩니다.',
      '잠금 파일은 반드시 커밋하세요. 어제와 오늘의 설치 결과가 다르면, 내 자리에서 되는 것과 배포에서 터지는 것 사이의 간극을 영원히 쫓게 됩니다.',
    ],
  },
  {
    keywords: ['타입', '제네릭'],
    replies: [
      '타입은 통과시키는 도구가 아니라 설계를 적는 언어입니다. 불가능한 상태를 표현할 수 없게 타입을 좁히면, 그만큼의 버그가 컴파일에서 사라집니다.',
      'any 는 타입 시스템의 비상구지만, 한번 열리면 오류가 그 문으로 퍼져 나갑니다. 정말 모르는 값이라면 unknown 으로 받고 좁혀서 쓰는 습관이 안전합니다.',
      '제네릭이 세 겹을 넘어가면 잠시 멈추고 이름 붙은 타입으로 풀어 보세요. 타입도 코드입니다. 읽는 사람이 추론을 따라갈 수 없다면 설계를 의심할 때입니다.',
      '타입 단언은 컴파일러와의 논쟁을 이기는 방법이 아니라 포기하는 방법입니다. 단언이 필요해진 지점은 대개 타입 설계가 실제 데이터 흐름과 어긋난 지점이에요.',
    ],
  },
  {
    keywords: ['css', '스타일', '레이아웃', '반응형'],
    replies: [
      'CSS 가 자꾸 싸운다면 전역을 의심하세요. 스코프를 좁히고 토큰으로 값을 모으면, 스타일 수정이 다른 화면을 깨뜨리는 일이 급격히 줄어듭니다.',
      '반응형은 기기 폭의 나열보다 콘텐츠 기준이 오래갑니다. 유명한 화면 폭을 외우지 말고, 레이아웃이 실제로 무너지는 지점에 분기점을 두세요.',
      '특이성 전쟁에서 이기는 방법은 더 센 선택자가 아니라 더 낮은 특이성입니다. 전부 클래스 한 겹으로 평평하게 유지하면 강제 우선순위는 필요해지지 않습니다.',
      '어림값 간격은 곧 어긋납니다. 간격과 색을 토큰으로 모아 두면 다크 모드나 밀도 조정 같은 전역 변경이 파일 하나의 일이 됩니다.',
    ],
  },
  {
    keywords: ['접근성', 'aria', '스크린 리더', '키보드'],
    replies: [
      '접근성은 마지막에 얹는 옵션이 아니라 기본 문법에 가깝습니다. 시맨틱 태그와 포커스 흐름만 지켜도 대부분의 사용자를 잃지 않습니다.',
      'aria 속성을 더하기 전에 시맨틱 태그로 해결되는지 먼저 보세요. 이미 있는 길을 두고 새로 포장할 이유는 없습니다.',
      '키보드만으로 화면을 한 바퀴 돌아 보세요. 포커스가 어디 있는지 안 보이거나 모달에서 빠져나올 수 없다면, 마우스 없는 사용자에게는 그 화면이 잠겨 있는 것입니다.',
      '이미지의 대체 텍스트는 무엇이 그려져 있는지가 아니라 왜 거기 있는지를 적으세요. 장식이라면 비워서 스크린 리더가 건너뛰게 하는 것도 배려입니다.',
    ],
  },
  {
    keywords: ['커밋', '브랜치', '깃', 'git'],
    replies: [
      '커밋은 작업의 저장이 아니라 의도의 기록입니다. 하나의 커밋이 하나의 이유를 갖게 자르면, 리뷰도 롤백도 절반의 비용이 됩니다.',
      '커밋 메시지의 제목은 무엇을, 본문은 왜를 적으세요. 어떻게는 변경 내용이 이미 말해 줍니다. 반년 뒤에 이력을 추적하다 만나는 것은 코드가 아니라 그 이유입니다.',
      '브랜치는 수명이 짧을수록 건강합니다. 오래 사는 브랜치는 충돌을 이자로 불립니다. 작게 만들고 빨리 합치는 리듬이 통합의 고통을 줄여요.',
      '이력을 다듬는 것은 사치가 아닙니다. 되돌리기 쉬운 단위로 커밋이 나뉘어 있으면, 장애 대응의 첫 수가 원인 분석이 아니라 롤백이 될 수 있습니다.',
    ],
  },
  {
    keywords: ['배포', '릴리스', '릴리즈', '롤백'],
    replies: [
      '배포가 무섭다면 배포가 너무 큰 것입니다. 작게 자주 내보내고, 되돌리는 절차를 먼저 준비하세요. 롤백이 쉬우면 배포는 일상이 됩니다.',
      '배포와 릴리스를 분리해 보세요. 코드를 내보내는 것과 사용자에게 켜는 것을 스위치로 나누면, 문제가 생겼을 때 되돌리는 일이 재배포가 아니라 스위치가 됩니다.',
      '휴일 직전의 배포가 위험한 이유는 코드가 아니라 사람입니다. 문제를 발견할 눈과 대응할 손이 자리에 있을 때 내보내는 것이 가장 싼 보험입니다.',
      '배포 절차가 문서에만 있다면 아직 자동화가 아닙니다. 사람이 순서를 기억해야 하는 단계가 남아 있는 한, 언젠가 그 기억이 틀리는 날이 옵니다.',
    ],
  },
  {
    keywords: ['보안', '취약', '인증', '토큰'],
    replies: [
      '보안은 입력을 의심하는 습관에서 시작합니다. 사용자 입력이 닿는 모든 경계에서 검증하고, 신뢰는 데이터가 아니라 코드 경로에 두세요.',
      '비밀 값은 코드와 같은 저장소에 살면 안 됩니다. 한번이라도 커밋된 토큰은 이력에 영원히 남으니, 유출됐다고 간주하고 교체하는 것이 정석입니다.',
      '화면 문자열 조립의 기본은 이스케이프를 프레임워크에 맡기는 것입니다. 원문 삽입 우회로를 쓰는 순간부터는 그 문자열의 출처를 끝까지 증명할 책임이 생깁니다.',
      '권한 검사는 화면이 아니라 서버가 최종 책임자입니다. 버튼을 숨기는 것은 배려이고, 요청을 거부하는 것이 보안입니다.',
    ],
  },
  {
    keywords: ['문서', '주석', 'readme'],
    replies: [
      '문서는 결정의 이유를 남길 때 가장 값집니다. 코드는 무엇을 하는지 말해 주지만, 왜 그렇게 했는지는 시간이 지나면 아무도 기억하지 못하거든요.',
      '주석은 코드가 말할 수 없는 것만 말하게 하세요. 무엇을 하는지는 이름과 구조가 말하게 하고, 왜 이렇게 했는지와 왜 다르게 안 했는지를 주석에 남기는 겁니다.',
      '문서의 적은 분량이 아니라 부패입니다. 코드와 함께 고쳐지지 않는 문서는 언젠가 거짓말을 하기 시작해요. 코드 가까이에, 리뷰 범위 안에 두는 것이 부패를 늦춥니다.',
      '첫 문서는 새 동료의 첫 하루라고 생각하고 쓰세요. 설치, 실행, 테스트 세 가지가 복사해서 붙여넣는 대로 돌아가면 온보딩의 절반은 끝난 것입니다.',
    ],
  },
  {
    keywords: ['로그', '모니터링', '지표', '장애'],
    replies: [
      '로그는 많을수록 좋은 게 아니라 찾을 수 있을수록 좋습니다. 사건 단위로 맥락을 붙이고, 정상 흐름의 소음은 과감히 줄이는 편이 디버깅을 빠르게 합니다.',
      '장애 대응의 첫걸음은 관측입니다. 지표와 알림이 없으면 사용자가 우리보다 먼저 장애를 압니다. 대시보드는 장애가 나기 전에 만들어야 의미가 있어요.',
      '알림이 너무 많으면 알림이 없는 것과 같아집니다. 조치할 수 없는 알림은 끄고, 울리면 반드시 움직여야 하는 것만 남기세요. 무뎌진 감각이 가장 큰 장애 요인입니다.',
      '장애 회고의 목적은 범인 찾기가 아니라 재발 방지입니다. 같은 실수를 시스템이 막아 주게 바꾸는 것까지가 회고이고, 문서만 남는 회고는 다음 장애의 예고편입니다.',
    ],
  },
  {
    keywords: ['일정', '추정', '마감', '데드라인'],
    replies: [
      '추정이 자꾸 틀리는 것은 자연스러운 일입니다. 다만 크게 틀리는 작업은 대개 쪼개지지 않은 작업이에요. 하루 안에 끝나는 크기로 나누면 오차도 함께 줄어듭니다.',
      '마감이 밀리면 기능을 줄이는 것이 품질을 줄이는 것보다 낫습니다. 범위는 되돌릴 수 있지만, 무너진 품질 위에 쌓은 것들은 되돌리기 어렵습니다.',
      '일정의 적은 코딩 시간이 아니라 숨은 대기입니다. 리뷰 대기, 결정 대기, 답변 대기를 줄이는 것이 야근보다 일정에 크게 기여하는 경우가 많아요.',
      '낙관적 추정에는 이유가 있습니다. 우리는 타이핑 시간을 추정하지만 실제로는 이해, 논의, 검증에 시간을 씁니다. 지난 작업의 실제 기록이 감보다 정확한 추정 도구입니다.',
    ],
  },
  {
    keywords: ['회의', '미팅', '온보딩', '질문'],
    replies: [
      '회의가 길어진다면 결정할 것과 공유할 것을 분리해 보세요. 공유는 문서로 대체할 수 있지만, 결정은 사람이 모여야 빨라집니다.',
      '막힌 지 삼십 분이 넘었다면 혼자 붙잡지 말고 질문하세요. 질문을 정리하는 과정에서 스스로 답을 찾는 일도 많고, 아니어도 팀 전체의 시간을 아낍니다.',
      '새 동료가 헤매는 지점이 곧 코드베이스의 문서화 빚입니다. 온보딩 질문을 받을 때마다 답을 문서에 적어 두면, 같은 질문이 두 번 오지 않습니다.',
      '결정은 회의록보다 결정 기록으로 남기세요. 무엇을, 왜, 어떤 대안을 버리고 택했는지 세 줄이면 됩니다. 반년 뒤 같은 논쟁이 돌아왔을 때 그 세 줄이 회의 한 번을 아껴 줍니다.',
    ],
  },
];

/** 키워드가 없을 때의 일반 문안 16종. STEP 2 이래의 기본 문안이 풀의 앞자리다. */
const GENERAL_REPLIES = [
  '요약하면 세 가지입니다. 첫째, 상태의 출처를 하나로 유지하세요. 둘째, 파생 가능한 값은 저장하지 말고 계산하세요. 셋째, 비동기 흐름에는 반드시 실패 경로를 함께 설계하세요.',
  '좋은 질문이에요. 핵심은 문제를 작게 쪼개는 것입니다. 먼저 입력과 출력을 명확히 정의하고, 그다음 경계 조건을 나열해 보세요. 대부분의 버그는 경계에서 나옵니다.',
  '그 접근도 가능하지만 트레이드오프가 있습니다. 지금 규모에서는 단순한 쪽이 유지보수에 유리하고, 확장이 필요해지는 시점에 추상화를 도입해도 늦지 않습니다.',
  '동의합니다. 다만 한 가지 주의할 점은 캐시 무효화 타이밍이에요. 데이터를 바꾸는 쪽이 무효화 책임까지 가져가야 화면이 어긋나지 않습니다.',
  '기술 부채는 갚을 계획이 있을 때만 부채입니다. 계획 없이 쌓이는 것은 그냥 손실이에요. 부채를 남길 때는 어디에 남겼는지 기록부터 남기세요.',
  '마이그레이션은 한 번에 끝내려 하지 말고 되돌릴 수 있는 단계로 자르세요. 각 단계가 배포 가능해야 중간에 멈춰도 사고가 아닙니다.',
  '일관성은 취향보다 힘이 셉니다. 팀의 기존 방식이 내 취향과 달라도, 코드베이스 전체가 한 목소리를 내는 쪽이 유지보수에서는 이깁니다.',
  '아직 없는 규모를 위해 미리 복잡해지지 마세요. 확장 지점을 타입과 경계로 남겨 두는 것과, 지금 추상화를 들이는 것은 다른 일입니다.',
  '두 번 반복되면 참고, 세 번째에 공통화를 고민하세요. 성급한 재사용은 잘못된 추상화를 낳고, 잘못된 추상화는 중복보다 비쌉니다.',
  '캐시를 붙이기 전에 무효화 전략부터 정하세요. 언제 버릴지 답할 수 없는 캐시는 성능 개선이 아니라 미래의 정합성 버그입니다.',
  '프로토타입의 목적은 완성이 아니라 학습입니다. 무엇을 검증하려는지 먼저 적고, 검증이 끝나면 코드에 미련을 두지 마세요.',
  '시간대 버그는 저장과 표시를 섞을 때 생깁니다. 저장은 항상 한 기준으로, 변환은 표시 직전에 한 번만 하세요. 중간 계층이 시간을 만지기 시작하면 끝이 없습니다.',
  '데이터 모델은 화면보다 오래 삽니다. 화면에 맞춰 모델을 구부리지 말고, 사실을 그대로 담은 모델에서 화면용 형태를 파생하세요.',
  '모듈 경계는 감추는 것이 반입니다. 내보내는 것을 최소로 유지하면, 내부를 바꿀 자유가 그만큼 남습니다. 공개한 것은 전부 약속이 됩니다.',
  '새 기술은 장난감 프로젝트로 먼저 만져 보세요. 프로덕션은 학습의 장소로는 너무 비쌉니다. 검증된 뒤에 들여와도 늦지 않습니다.',
  '회고에서는 사람이 아니라 구조를 고치세요. 같은 실수가 반복된다면 그 자리에 있던 사람이 아니라, 누구든 같은 실수를 하게 만든 과정이 원인입니다.',
];

/** (마지막 사용자 입력, 방별 응답 일련번호) -> 문안. 순수 함수라 storage 없이 테스트된다. */
export function pickReply(input: string, seq: number): string {
  const text = input.toLowerCase();
  for (const topic of REPLY_TOPICS) {
    if (topic.keywords.some((keyword) => text.includes(keyword))) {
      return topic.replies[seq % topic.replies.length] ?? '';
    }
  }
  return GENERAL_REPLIES[seq % GENERAL_REPLIES.length] ?? '';
}

interface Ports {
  storage: KVStorage;
  isOnline: () => boolean;
  now: () => number;
  delays: MockChatApiDelays;
}

export function createMockChatApi(options: MockChatApiOptions = {}) {
  const ports: Ports = {
    storage: options.storage ?? createDefaultStorage(),
    isOnline:
      options.isOnline ?? (() => (typeof navigator === 'undefined' ? true : navigator.onLine)),
    now: options.now ?? (() => Date.now()),
    delays: { ...DEFAULT_DELAYS, ...options.delays },
  };

  /** 상태는 한 번 로드해 메모리에 두고, 변경 시마다 통째로 다시 저장한다(write-through). */
  let state: ChatState | null = null;

  /** 대화 검색 색인(STEP 16) - 메시지가 바뀔 때만 다시 굽는다. 무효화 지점은 persist/invalidateCache 둘뿐이다. */
  const searcher = createMessageSearcher();

  function loadState(): ChatState {
    if (state) return state;
    const raw = ports.storage.get(STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as ChatState;
        // 파싱 가드만으로는 부족하다 - "유효한 JSON 이지만 형태가 다른 값"(외부 조작,
        // 구버전 스키마)은 여기를 통과한 뒤 첫 rooms 접근에서 죽고, 리로드해도 같은
        // 값이라 재시도로 영원히 복구되지 않는다. 최소 형태를 확인하고 아니면 버린다.
        if (
          Array.isArray(parsed.rooms) &&
          typeof parsed.messages === 'object' &&
          parsed.messages !== null
        ) {
          state = parsed;
          return state;
        }
      } catch {
        // 손상된 저장 값(부분 쓰기, 외부 간섭)을 만나면 모든 호출이 영원히
        // 실패하는 것보다 데이터를 버리고 시드로 복구하는 쪽이 낫다 -
        // mock 데이터라 실손실이 없고, 사용자는 다음 화면부터 정상 동작을 본다.
      }
    }
    state = options.seed === false ? { rooms: [], messages: {} } : createSeedState(ports.now());
    persist();
    return state;
  }

  function persist() {
    if (!state) return;
    searcher.invalidate(); // 메시지/방이 바뀌었으니 다음 검색은 새로 색인한다
    try {
      ports.storage.set(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // 쓰기 실패(용량 초과 등)를 삼키면 메모리만 앞서간 유령 데이터가 남는다 -
      // 조회는 되는데 새로고침하면 사라지는 메시지. 캐시를 버려 다음 호출이
      // 진실원(저장소)에서 다시 읽게 하고, 실패는 호출자의 기존 에러 경로
      // (인라인 표시 + 재시도)로 전파한다. 뮤테이션마다 롤백을 심는 것보다
      // "버리고 다시 읽기"가 적은 코드로 항상 일관성을 보장한다.
      state = null;
      throw new ChatApiError('STORAGE_FULL', '저장 공간이 부족해 변경을 저장하지 못했습니다.');
    }
  }

  /** 중단 가능한 지연(STEP 11). signal 이 이미/도중에 abort 되면 AbortError 로 거부한다. */
  function delay(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const abortError = () => new DOMException('중단되었습니다.', 'AbortError');
      if (signal?.aborted) {
        reject(abortError());
        return;
      }
      const onAbort = () => {
        clearTimeout(timer);
        reject(abortError());
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  function ensureOnline() {
    if (!ports.isOnline()) {
      throw new ChatApiError('NETWORK_OFFLINE', '네트워크에 연결되어 있지 않습니다.');
    }
  }

  function requireRoom(chatId: string): ChatRoom {
    const room = loadState().rooms.find((r) => r.id === chatId);
    if (!room) throw new ChatApiError('NOT_FOUND', `채팅방이 없습니다: ${chatId}`);
    return room;
  }

  function roomMessages(chatId: string): Message[] {
    const s = loadState();
    const list = s.messages[chatId];
    if (list) return list;
    const created: Message[] = [];
    s.messages[chatId] = created;
    return created;
  }

  /** 목록에서 마지막 사용자 메시지의 본문 텍스트를 찾는다(트리거 판별·응답 대상). */
  function lastUserTextIn(list: Message[]): string {
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i];
      if (m && m.role === 'user') return messageText(m);
    }
    return '';
  }

  /**
   * 방별 응답 일련번호 - 문안 선택의 지표(STEP 15).
   *
   * 메시지 수를 지표로 쓰면 두 가지가 어긋난다: 교환마다 2씩 늘어(사용자+응답)
   * 짝수 크기 풀은 같은 홀짝의 절반만 순회하고, 재생성(응답 삭제 후 재요청)은
   * 수가 제자리라 같은 문안이 그대로 돌아온다. 확정된 응답마다 1씩 자라는
   * 일련번호는 둘 다 해소한다 - 삭제와 무관하게 앞으로만 가므로 재생성이
   * 말 그대로 "같은 질문에 새 응답"이 된다. 증가는 응답 확정(영속)과 함께
   * 저장하므로 중단된 응답은 번호를 소비하지 않는다.
   */
  function replySeqOf(chatId: string): number {
    return loadState().replySeq?.[chatId] ?? 0;
  }

  function advanceReplySeq(chatId: string): void {
    const s = loadState();
    const seqs = s.replySeq ?? (s.replySeq = {});
    seqs[chatId] = (seqs[chatId] ?? 0) + 1;
  }

  function toSummary(room: ChatRoom): ChatRoomSummary {
    const list = roomMessages(room.id);
    const last = list.length > 0 ? list[list.length - 1] : undefined;
    return {
      ...room,
      lastMessageAt: last ? last.createdAt : null,
      lastMessagePreview: last ? messageText(last) : null,
    };
  }

  return {
    /**
     * 메모리 캐시를 비워 다음 호출이 저장소를 다시 읽게 한다.
     *
     * 상태는 성능을 위해 한 번 파싱해 메모리에 들고 있으므로(write-through),
     * "다른 탭"이 저장소를 바꾼 것은 이 인스턴스가 스스로 알 수 없다.
     * 다중 탭 동기화는 storage 이벤트(다른 탭의 쓰기에서만 발생)를 받은 쪽이
     * 이 메서드로 캐시를 버리고 재조회하는 것으로 완성된다.
     */
    invalidateCache(): void {
      state = null;
      searcher.invalidate(); // 다른 탭이 바꾼 메시지가 검색에도 반영되게
    },

    /** 채팅 목록 조회 - 마지막 대화 시간 내림차순(대화가 없으면 생성 시간). */
    async listChatRooms(): Promise<ChatRoomSummary[]> {
      ensureOnline();
      await delay(ports.delays.read);
      return loadState()
        .rooms.map(toSummary)
        .sort(
          (a, b) => (b.lastMessageAt ?? b.createdAt) - (a.lastMessageAt ?? a.createdAt),
        );
    },

    /** 채팅방 조회 */
    async getChatRoom(chatId: string): Promise<ChatRoom> {
      ensureOnline();
      await delay(ports.delays.read);
      return { ...requireRoom(chatId) };
    },

    /** 채팅방 생성 */
    async createChatRoom(input: { title: string; type?: ChatRoomType }): Promise<ChatRoom> {
      ensureOnline();
      const title = input.title.trim();
      if (!title) throw new ChatApiError('INVALID_TITLE', '제목이 비어 있습니다.');
      await delay(ports.delays.write);
      const now = ports.now();
      const room: ChatRoom = {
        id: createId('chat'),
        title: deriveRoomTitle(title),
        type: input.type ?? 'default',
        createdAt: now,
        updatedAt: now,
      };
      const s = loadState();
      s.rooms.push(room);
      s.messages[room.id] = [];
      persist();
      return { ...room };
    },

    /** 채팅방 삭제 - 방과 메시지를 함께 지운다. */
    async deleteChatRoom(chatId: string): Promise<void> {
      ensureOnline();
      requireRoom(chatId);
      await delay(ports.delays.write);
      const s = loadState();
      s.rooms = s.rooms.filter((r) => r.id !== chatId);
      delete s.messages[chatId];
      if (s.replySeq) delete s.replySeq[chatId];
      persist();
    },

    /** 채팅방 제목 수정 */
    async renameChatRoom(chatId: string, title: string): Promise<ChatRoom> {
      ensureOnline();
      const trimmed = title.trim();
      if (!trimmed) throw new ChatApiError('INVALID_TITLE', '제목이 비어 있습니다.');
      requireRoom(chatId); // 존재 검증은 지연 전에 - 없는 방이면 즉시 거절한다
      await delay(ports.delays.write);
      // 변이 대상은 지연 "후" 다시 얻는다. 지연 중 invalidateCache(다른 탭 동기화)가
      // 끼어들면 지연 전 참조는 버려진 상태의 객체라 변이가 조용히 유실된다.
      const room = requireRoom(chatId);
      room.title = deriveRoomTitle(trimmed);
      room.updatedAt = ports.now();
      persist();
      return { ...room };
    },

    /**
     * 메시지 리스트 조회 - 50개 단위 커서 페이지네이션.
     * 첫 호출(before 없음)은 최신 50개, 이후 before=nextBefore 로 더 오래된 페이지를 가져온다.
     */
    async listMessages(params: {
      chatId: string;
      before?: string;
      limit?: number;
    }): Promise<MessagePage> {
      ensureOnline();
      requireRoom(params.chatId);
      await delay(ports.delays.read);
      const all = roomMessages(params.chatId);
      const limit = params.limit ?? 50;

      let end = all.length;
      if (params.before) {
        const cursor = parseCursor(params.before);
        if (!cursor) {
          throw new ChatApiError('NOT_FOUND', `잘못된 커서입니다: ${params.before}`);
        }
        // 커서보다 "엄격히 이전" 인 메시지 수가 곧 다음 페이지의 상한 인덱스다. all 은 시간
        // 오름차순이라 이 카운트가 위치와 일치하며, 경계 메시지가 삭제됐어도 그대로 성립한다.
        end = all.filter((m) => isBeforeCursor(m, cursor)).length;
      }
      const start = Math.max(0, end - limit);
      const items = all.slice(start, end).map((m) => ({ ...m }));
      const first = items[0];
      return {
        items,
        nextBefore: start > 0 && first ? encodeCursor(first) : null,
      };
    },

    /**
     * 대화 전문 검색(STEP 16) - 모든 방의 메시지 본문에서 찾는다.
     *
     * 방 목록 필터(제목·미리보기 부분일치)와 달리 관련도 랭킹이 필요해 검색 엔진을 쓴다.
     * 지금은 클라이언트 색인이지만 계약은 "질의를 주면 결과를 준다" 하나라, 서버 검색으로
     * 옮길 때 이 메서드의 구현만 바뀌고 화면 코드는 그대로다.
     */
    async searchMessages(
      query: string,
      options?: { limit?: number },
    ): Promise<MessageSearchHit[]> {
      ensureOnline();
      await delay(ports.delays.read);
      return searcher.search(loadState(), query, options?.limit);
    },

    /**
     * 사용자 메시지 전송. 즉시 확정되어 반환된다.
     * (응답 생성은 streamReply 로 분리 - 개요의 스트리밍 전환 예고 때문이다.
     *  전송과 응답 수신은 미래에 서로 다른 채널이 된다.)
     */
    async sendMessage(chatId: string, content: string): Promise<Message> {
      ensureOnline();
      if (requireRoom(chatId).type === 'receive-only') {
        throw new ChatApiError('RECEIVE_ONLY', '받은 메시지 전용 채팅방입니다.');
      }
      await delay(ports.delays.write);
      const room = requireRoom(chatId); // 지연 후 재획득 - rename 과 같은 이유
      const message: Message = {
        id: createId('msg'),
        chatId,
        role: 'user',
        parts: [{ type: 'text', text: content }],
        createdAt: ports.now(),
      };
      roomMessages(chatId).push(message);
      room.updatedAt = message.createdAt;
      persist();
      return { ...message };
    },

    /**
     * 메시지 피드백(STEP 11) - 평가를 저장하고 갱신된 메시지를 돌려준다.
     * null 은 해제다(필드를 지워 "평가하지 않음"으로 되돌린다). 영속되므로
     * 새로고침 뒤에도 남는다 - 영속 없는 피드백은 유령 UI 라서 만들지 않았다.
     */
    async rateMessage(
      chatId: string,
      messageId: string,
      rating: MessageRating | null,
    ): Promise<Message> {
      ensureOnline();
      requireRoom(chatId);
      await delay(ports.delays.write);
      // 변이 대상은 지연 후 재획득한다(rename 과 같은 이유 - 캐시 무효화 경합).
      requireRoom(chatId);
      const message = roomMessages(chatId).find((m) => m.id === messageId);
      if (!message) throw new ChatApiError('NOT_FOUND', `메시지가 없습니다: ${messageId}`);
      if (rating === null) delete message.rating;
      else message.rating = rating;
      persist();
      return { ...message };
    },

    /**
     * 메시지 삭제(STEP 11) - 응답 재생성의 재료다: 마지막 응답을 지우고
     * streamReply 를 다시 부르면 같은 질문에 새 응답이 온다. "새" 응답인 것은
     * 선택 지표(응답 일련번호)가 삭제와 무관하게 전진하기 때문이다(STEP 15).
     */
    async deleteMessage(chatId: string, messageId: string): Promise<void> {
      ensureOnline();
      requireRoom(chatId);
      await delay(ports.delays.write);
      requireRoom(chatId); // 지연 후 재획득 - rename 과 같은 이유
      const s = loadState();
      const list = s.messages[chatId];
      if (!list?.some((m) => m.id === messageId)) {
        throw new ChatApiError('NOT_FOUND', `메시지가 없습니다: ${messageId}`);
      }
      s.messages[chatId] = list.filter((m) => m.id !== messageId);
      persist();
    },

    /**
     * 메시지 응답 - 마지막 사용자 메시지에 대한 어시스턴트 응답을 스트림으로 내보낸다.
     * 지금은 명세대로 2초 뒤 완성본 하나('done')지만, 시그니처는 증분('delta')을 수용한다.
     * 마지막 사용자 메시지에 "/error" 가 들어 있으면 실패한다(에러 상태 데모용, 결정적).
     *
     * 중단(options.signal, STEP 11)의 의미론이 깔끔한 이유는 흐름의 순서다: 응답은
     * 지연이 끝난 뒤에야 생성/영속되므로, 지연 중 중단하면 아무것도 남지 않는다.
     */
    async *streamReply(
      chatId: string,
      options?: { signal?: AbortSignal },
    ): AsyncGenerator<ReplyEvent> {
      ensureOnline();
      requireRoom(chatId);
      const signal = options?.signal;

      /*
       * '/stream' 데모(STEP 12) - SSE/Socket 전환 예고의 시연. 같은 시간 예산
       * (delays.reply) 안에서 응답이 어절 단위 'delta' 로 증분 도착하고, 영속은
       * 완결(done) 직전에만 한다 - "중단하면 아무것도 남지 않는다"(STEP 11)가
       * 스트림에도 동일하게 적용된다. '/error' 가 함께 있으면 실패가 우선한다.
       * 트리거 판별은 부작용 없는 피크로 읽는다(roomMessages 의 "없으면 만들기" 회피).
       */
      const peek = loadState().messages[chatId] ?? [];
      const peekText = lastUserTextIn(peek);
      if (peekText.includes('/stream') && !peekText.includes('/error')) {
        const text = pickReply(peekText, replySeqOf(chatId));
        const words = text.split(' ');
        const gap = Math.max(1, Math.floor(ports.delays.reply / Math.max(1, words.length)));
        for (let i = 0; i < words.length; i++) {
          await delay(gap, signal);
          ensureOnline(); // 전송 중 회선이 끊기면 스트림도 끊긴다
          yield { type: 'delta', text: (i > 0 ? ' ' : '') + words[i] };
        }
        const room = requireRoom(chatId); // 스트리밍 중 삭제된 방 - 영속 전에 확인
        const all = roomMessages(chatId);
        const reply: Message = {
          id: createId('msg'),
          chatId,
          role: 'assistant',
          parts: [{ type: 'text', text }],
          createdAt: ports.now(),
        };
        all.push(reply);
        advanceReplySeq(chatId);
        room.updatedAt = reply.createdAt;
        persist();
        yield { type: 'done', message: { ...reply } };
        return;
      }

      await delay(ports.delays.reply, signal);
      ensureOnline(); // 대기 중 오프라인이 됐을 수도 있다
      // 존재 검증이 roomMessages 보다 먼저다 - 순서가 바뀌면 "없으면 만들기" 부작용이
      // 대기 중 삭제된 방의 메시지 엔트리를 고아로 되살린다.
      const room = requireRoom(chatId);

      const all = roomMessages(chatId);
      const lastUserText = lastUserTextIn(all);
      if (lastUserText.includes('/error')) {
        throw new ChatApiError('REPLY_FAILED', '응답 생성에 실패했습니다. (데모용 트리거)');
      }

      const reply: Message = {
        id: createId('msg'),
        chatId,
        role: 'assistant',
        parts: [{ type: 'text', text: pickReply(lastUserText, replySeqOf(chatId)) }],
        createdAt: ports.now(),
      };
      all.push(reply);
      advanceReplySeq(chatId);
      room.updatedAt = reply.createdAt;
      persist();
      yield { type: 'done', message: { ...reply } };
    },

    /**
     * 방별 응답 일련번호를 읽는다(SSE 전송 데모용). streamReply 가 문안 선택에 쓰는 것과
     * 같은 지표라, 서버가 이 값으로 pickReply 하면 재생성 의미론(삭제와 무관하게 전진)이 일치한다.
     */
    async getReplySeq(chatId: string): Promise<number> {
      ensureOnline();
      requireRoom(chatId);
      return replySeqOf(chatId);
    },

    /**
     * 외부(SSE 서버)에서 생성된 어시스턴트 응답을 영속한다. streamReply 가 in-process 로 하던
     * 영속(push + 일련번호 전진 + 방 updatedAt)을 전송 계층만 바꿔 재사용할 수 있게 분리한 것으로,
     * 실서버 전환 데모의 "소비 코드 변경 0" 을 성립시키는 쓰기 원시(primitive)다.
     */
    async appendAssistantReply(chatId: string, text: string): Promise<Message> {
      ensureOnline();
      const room = requireRoom(chatId);
      const reply: Message = {
        id: createId('msg'),
        chatId,
        role: 'assistant',
        parts: [{ type: 'text', text }],
        createdAt: ports.now(),
      };
      roomMessages(chatId).push(reply);
      advanceReplySeq(chatId);
      room.updatedAt = reply.createdAt;
      persist();
      return { ...reply };
    },
  };
}

export type ChatApi = ReturnType<typeof createMockChatApi>;

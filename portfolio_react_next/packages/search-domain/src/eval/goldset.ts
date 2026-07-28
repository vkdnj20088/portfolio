/**
 * 평가용 골드셋. 검색·독해 품질을 "느낌"이 아니라 숫자로 관리하기 위한 라벨 데이터다.
 *
 * 세 갈래로 나눈 이유:
 *  - exact       : 질문이 문서의 어휘를 그대로 쓴다. 기본기(정확 일치 랭킹)를 본다.
 *  - paraphrase  : 문서에 없는 말(동의어·구어)로만 묻는다. 동의어 확장이 실제로 값을 하는지 본다.
 *  - unanswerable: 코퍼스에 답이 없다. 지어내지 않고 "정답 없음"을 내는지 본다 - 신뢰성의 핵심 지표.
 *
 * gold 는 정답 근거가 있는 문단 id(불응답이어야 하면 null). 라벨은 코퍼스를 읽고 손으로 달았다.
 */
export type EvalSplit = 'exact' | 'paraphrase' | 'unanswerable';

export interface EvalCase {
  q: string;
  /** 정답 근거 문단 id. null 이면 "답이 없어야 정답". */
  gold: string | null;
  split: EvalSplit;
}

export const GOLDSET: EvalCase[] = [
  // ── exact: 문서 어휘를 그대로 쓴 질문 ────────────────────────────────
  { q: '연차는 며칠 부여되나요?', gold: 'HR-01-p1', split: 'exact' },
  { q: '반차는 어떻게 사용하나요?', gold: 'HR-01-p2', split: 'exact' },
  { q: '병가는 며칠까지 쓸 수 있나요?', gold: 'HR-01-p3', split: 'exact' },
  { q: '경조사 휴가는 며칠인가요?', gold: 'HR-01-p4', split: 'exact' },
  { q: '재택근무는 주 며칠까지 가능한가요?', gold: 'HR-02-p2', split: 'exact' },
  { q: '초과근무는 어떻게 보상되나요?', gold: 'HR-02-p3', split: 'exact' },
  { q: '비밀번호는 몇 자 이상이어야 하나요?', gold: 'SEC-01-p1', split: 'exact' },
  { q: '비밀번호는 얼마마다 변경해야 하나요?', gold: 'SEC-01-p2', split: 'exact' },
  { q: '지정가 주문은 어떻게 체결되나요?', gold: 'PROD-01-p1', split: 'exact' },
  { q: '출금할 때 무엇이 필요한가요?', gold: 'PROD-01-p3', split: 'exact' },
  { q: '커스텀 확장자는 몇 개까지 등록하나요?', gold: 'PROD-02-p2', split: 'exact' },
  { q: '경비 정산은 언제까지 청구해야 하나요?', gold: 'HR-03-p1', split: 'exact' },
  { q: '자기계발비는 연 얼마까지 지원되나요?', gold: 'HR-03-p3', split: 'exact' },
  { q: '온콜 담당자는 어떻게 정해지나요?', gold: 'INFRA-01-p3', split: 'exact' },
  { q: '프로덕션 배포는 언제 할 수 있나요?', gold: 'INFRA-01-p1', split: 'exact' },

  // ── paraphrase: 동의어·구어로만 물은 질문 ────────────────────────────
  { q: '휴가는 며칠 받나요?', gold: 'HR-01-p1', split: 'paraphrase' },
  { q: '유급휴가 일수가 궁금합니다', gold: 'HR-01-p1', split: 'paraphrase' },
  { q: '암호 만드는 규칙이 어떻게 되나요?', gold: 'SEC-01-p1', split: 'paraphrase' },
  { q: '원격 근무 신청은 어떻게 해요?', gold: 'HR-02-p2', split: 'paraphrase' },
  { q: '인출할 때 뭐가 필요해?', gold: 'PROD-01-p3', split: 'paraphrase' },
  { q: '매수 주문은 어떻게 넣나요?', gold: 'PROD-01-p1', split: 'paraphrase' },
  { q: '릴리스는 언제 할 수 있나요?', gold: 'INFRA-01-p1', split: 'paraphrase' },
  { q: '인시던트 1차 대응은 몇 분 안에 하나요?', gold: 'INFRA-01-p3', split: 'paraphrase' },
  { q: '노트북을 잃어버리면 어떻게 하나요?', gold: 'SEC-02-p3', split: 'paraphrase' },
  { q: '세미나 참가비도 지원되나요?', gold: 'HR-03-p3', split: 'paraphrase' },

  // ── unanswerable: 코퍼스에 답이 없는 질문(지어내면 안 된다) ──────────
  { q: '주차장은 몇 시까지 운영하나요?', gold: null, split: 'unanswerable' },
  { q: '대표이사 이름이 뭔가요?', gold: null, split: 'unanswerable' },
  { q: '육아휴직은 얼마나 쓸 수 있나요?', gold: null, split: 'unanswerable' },
  { q: '반려동물을 데려와도 되나요?', gold: null, split: 'unanswerable' },
  { q: '사내 헬스장은 어디에 있나요?', gold: null, split: 'unanswerable' },
  { q: '퇴직금은 어떻게 계산되나요?', gold: null, split: 'unanswerable' },
  { q: '주식 배당은 언제 나오나요?', gold: null, split: 'unanswerable' },
  { q: '해외 지사는 몇 개인가요?', gold: null, split: 'unanswerable' },
];

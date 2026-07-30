import { search, type FollowUpContext } from '../retrieval';
import { ALL_PASSAGES } from '../corpus';

/**
 * 후속질문 평가(#D1) - 대화 컨텍스트가 <b>실제로</b> 정확도를 올리는지 측정한다.
 *
 * <h2>왜 별도 골드셋인가</h2>
 * 기존 골드셋(GOLDSET)은 단발 질의라 컨텍스트를 쓸 자리가 없다. 후속질문의 성질은
 * <b>질의 자체만으로는 답을 찾을 수 없다</b>는 것이다("그건 며칠이야?"). 그런 질의를 따로 라벨링해야
 * "컨텍스트가 값을 하는가"를 물을 수 있다.
 *
 * <h2>측정이 채택 조건이다</h2>
 * 이 파일의 목적은 기능을 자랑하는 것이 아니라 <b>판정</b>이다. 컨텍스트가 정확도를 올리면 채택하고,
 * 내리면 채택하지 않고 그 사실을 기록한다. 구현했다는 사실이 채택 근거가 되어서는 안 된다.
 */

export interface FollowUpCase {
  /** 1턴 질의 - 문서를 특정할 수 있는 온전한 질문. */
  first: string;
  /** 2턴 질의 - 생략/대명사가 있어 단독으로는 모호하다. */
  followUp: string;
  /** 후속질의의 정답 근거 문단 id. */
  gold: string;
  /** 1턴 답변의 출처 문서 id(컨텍스트로 고정될 값). */
  pinnedDocId: string;
}

/**
 * 후속질문 골드셋. 전부 "2턴만 보면 어느 문서인지 알 수 없는" 질의다 - 그렇지 않으면
 * 컨텍스트 없이도 맞혀서 측정 자체가 무의미해진다.
 */
export const FOLLOWUP_GOLDSET: FollowUpCase[] = [
  {
    first: '연차는 며칠 부여되나요?',
    followUp: '반차는 어떻게 쓰나요?',
    gold: 'HR-01-p2',
    pinnedDocId: 'HR-01',
  },
  {
    first: '연차는 며칠 부여되나요?',
    followUp: '병가는 며칠까지인가요?',
    gold: 'HR-01-p3',
    pinnedDocId: 'HR-01',
  },
  {
    first: '재택근무는 주 며칠까지 가능한가요?',
    followUp: '초과근무는 어떻게 보상되나요?',
    gold: 'HR-02-p3',
    pinnedDocId: 'HR-02',
  },
  {
    first: '비밀번호는 몇 자 이상이어야 하나요?',
    followUp: '얼마마다 바꿔야 하나요?',
    gold: 'SEC-01-p2',
    pinnedDocId: 'SEC-01',
  },
  {
    first: '지정가 주문은 어떻게 체결되나요?',
    followUp: '출금할 때는 무엇이 필요한가요?',
    gold: 'PROD-01-p3',
    pinnedDocId: 'PROD-01',
  },
  {
    first: '경비 정산은 언제까지 청구해야 하나요?',
    followUp: '자기계발비는 연 얼마인가요?',
    gold: 'HR-03-p3',
    pinnedDocId: 'HR-03',
  },
  {
    first: '프로덕션 배포는 언제 할 수 있나요?',
    followUp: '온콜 담당자는 어떻게 정해지나요?',
    gold: 'INFRA-01-p3',
    pinnedDocId: 'INFRA-01',
  },
];

export interface FollowUpScore {
  n: number;
  recall1: number;
  recall3: number;
  mrr: number;
}

export interface FollowUpReport {
  /** 컨텍스트 없이 후속질의만 검색(대조군). */
  withoutContext: FollowUpScore;
  /** 직전 질의어 확장만 적용. */
  queryExpansionOnly: FollowUpScore;
  /** 문서 고정만 적용. */
  docPinOnly: FollowUpScore;
  /** 둘 다 적용(실험군). */
  full: FollowUpScore;
}

function rankOf(query: string, gold: string, ctx?: FollowUpContext): number {
  const hits = search(query, 'semantic', 5, ctx);
  const idx = hits.findIndex((h) => h.passage.id === gold);
  return idx < 0 ? 0 : idx + 1; // 1-based, 0 = 미발견
}

function score(ranks: number[]): FollowUpScore {
  const n = ranks.length;
  const at = (k: number) => ranks.filter((r) => r > 0 && r <= k).length / n;
  const mrr = ranks.reduce((a, r) => a + (r > 0 ? 1 / r : 0), 0) / n;
  return { n, recall1: at(1), recall3: at(3), mrr };
}

/**
 * 네 조건을 같은 골드셋으로 나란히 측정한다. 조건을 쪼개는 이유: "컨텍스트가 좋다"가 아니라
 * <b>어느 장치가 값을 하는지</b> 알아야 한다. 하나가 도움이 되고 다른 하나가 해가 될 수 있고,
 * 합쳐서 측정하면 그 상쇄가 보이지 않는다.
 */
export function evaluateFollowUp(cases: FollowUpCase[] = FOLLOWUP_GOLDSET): FollowUpReport {
  const none: number[] = [];
  const qOnly: number[] = [];
  const pinOnly: number[] = [];
  const both: number[] = [];
  for (const c of cases) {
    none.push(rankOf(c.followUp, c.gold));
    qOnly.push(rankOf(c.followUp, c.gold, { previousQuery: c.first }));
    pinOnly.push(rankOf(c.followUp, c.gold, { pinnedDocId: c.pinnedDocId }));
    both.push(rankOf(c.followUp, c.gold, { previousQuery: c.first, pinnedDocId: c.pinnedDocId }));
  }
  return {
    withoutContext: score(none),
    queryExpansionOnly: score(qOnly),
    docPinOnly: score(pinOnly),
    full: score(both),
  };
}

/** 골드셋 라벨이 실제 코퍼스를 가리키는지 - 라벨 오타는 측정 결과를 조용히 망친다. */
export function validateFollowUpGoldset(cases: FollowUpCase[] = FOLLOWUP_GOLDSET): string[] {
  const ids = new Set(ALL_PASSAGES.map((p) => p.id));
  const errors: string[] = [];
  for (const c of cases) {
    if (!ids.has(c.gold)) errors.push(`존재하지 않는 gold 문단: ${c.gold}`);
    if (!c.gold.startsWith(c.pinnedDocId)) {
      errors.push(`gold(${c.gold})가 pinnedDocId(${c.pinnedDocId})에 속하지 않습니다`);
    }
  }
  return errors;
}

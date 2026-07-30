import { ALL_PASSAGES, DOC_BY_ID } from './corpus';
import { createIndex, tokenize } from './textIndex';
import type { ScoredPassage, SearchMode } from './types';

/**
 * 사내문서 코퍼스 어댑터. 검색 알고리즘은 textIndex(범용 엔진)에 있고, 여기서는 그 엔진에 코퍼스를
 * 물려 만든 인스턴스 하나를 들고, 결과(id + 점수)를 문단·문서 메타가 붙은 도메인 형태로 되돌린다.
 *
 * 엔진과 코퍼스를 가른 이유: 같은 엔진이 채팅 메시지처럼 계속 늘어나는 다른 데이터에도 붙어야 하기
 * 때문이다. 코퍼스는 그중 "고정된 문서 집합" 인스턴스 하나일 뿐이다.
 */
const CORPUS_INDEX = createIndex(ALL_PASSAGES.map((p) => ({ id: p.id, text: p.text })));
const PASSAGE_BY_ID = new Map(ALL_PASSAGES.map((p) => [p.id, p]));

export { tokenize };

/** 질의 전용 토크나이즈(사전 가드형) - 코퍼스 어휘를 기준으로 한다. */
export function tokenizeQuery(text: string): string[] {
  return CORPUS_INDEX.tokenizeQuery(text);
}

/** 용어의 희소성(IDF). 독해 채점이 "수/것/때" 같은 흔한 말에 점수를 주지 않도록 공유한다. */
export function idfOf(term: string): number {
  return CORPUS_INDEX.idfOf(term);
}

/**
 * 동의어 확장 결과. 검색과 독해가 사전을 하나만 보게 해서, 검색이 끌어온 문단을 독해가 다른
 * 기준으로 읽는 어긋남을 없앤다(이전에는 두 벌의 사전이 6개 키에서 서로 달랐다).
 */
export function expansionsOf(term: string): string[] {
  return CORPUS_INDEX.expansionsOf(term);
}

/**
 * 후속질문 컨텍스트(#D1). 단발 QA 와 대화형의 차이는 <b>어떤 상태를 들고 가고 언제 버리는가</b>다.
 *
 * §0 상 LLM 이 없으므로 "컨텍스트"는 프롬프트가 아니라 **검색 조건**으로 구현된다:
 *  - previousQuery: 직전 질의어를 이번 질의에 더해 확장한다("그건 며칠이야?" 같은 생략 보완)
 *  - pinnedDocId:   직전 답변의 출처 문서로 후보를 좁힌다("이 문서에서 더 묻기")
 *
 * 두 장치가 실제로 정확도를 올리는지는 골드셋으로 측정한다 - 올리지 않으면 채택하지 않는다.
 */
export interface FollowUpContext {
  /**
   * 직전 질의어를 이번 질의에 더해 확장한다.
   *
   * <b>측정 결과 제품 경로에서는 쓰지 않는다.</b> 골드셋 7문항(evaluateFollowUp)으로 재 보니
   * R@1 이 71.4% -> 28.6%, MRR 0.786 -> 0.564 로 <b>떨어졌다</b>. 직전 질의어가 상위 결과를
   * 지배해 "이번에 물은 것"이 밀리기 때문이다 - 사람이 보기에 자연스러운 보완이 어휘 랭킹에서는
   * 노이즈였다. 이 필드는 그 판정을 재현하기 위한 <b>측정 도구</b>로만 남긴다(제거하면 다음
   * 사람이 같은 아이디어를 다시 시도하며 같은 측정을 반복한다).
   */
  previousQuery?: string;
  /**
   * 직전 답변의 출처 문서. 지정되면 그 문서의 문단만 후보가 된다.
   *
   * <b>채택됨.</b> 같은 골드셋에서 R@1 71.4% -> 85.7%, MRR 0.786 -> 0.857 로 올랐다.
   * 후속질문의 실제 성질이 "같은 문서 안에서 더 묻는다"이기 때문이다 - 컨텍스트를 질의어가
   * 아니라 <b>검색 범위</b>로 해석한 쪽이 맞았다.
   */
  pinnedDocId?: string | null;
}

/**
 * 질의를 코퍼스 전체에 대해 채점해 상위 결과를 반환. mode 로 정렬 기준(시맨틱/키워드)을 바꾼다.
 *
 * ctx 가 주어지면 후속질문으로 처리한다(#D1). 제품 경로는 pinnedDocId 만 넘긴다 -
 * previousQuery 확장은 측정에서 정확도를 떨어뜨려 채택하지 않았다(FollowUpContext 주석 참고).
 */
export function search(
  query: string,
  mode: SearchMode = 'semantic',
  limit = 8,
  ctx?: FollowUpContext,
): ScoredPassage[] {
  const effective = ctx?.previousQuery ? `${query} ${ctx.previousQuery}` : query;
  // 문서 고정이 있으면 그 문서 안에서만 고르므로 후보를 넉넉히 받아 필터 후 limit 을 맞춘다.
  const want = ctx?.pinnedDocId ? Math.max(limit * 8, 40) : limit;
  const hits = CORPUS_INDEX.search(effective, mode, want);
  const out: ScoredPassage[] = [];
  for (const hit of hits) {
    const passage = PASSAGE_BY_ID.get(hit.id);
    if (!passage) continue;
    if (ctx?.pinnedDocId && passage.docId !== ctx.pinnedDocId) continue;
    const doc = DOC_BY_ID.get(passage.docId);
    out.push({
      passage,
      docTitle: doc?.title ?? passage.docId,
      category: doc?.category ?? '',
      semantic: hit.semantic,
      keyword: hit.keyword,
      matched: hit.matched,
    });
    if (out.length >= limit) break;
  }
  return out;
}

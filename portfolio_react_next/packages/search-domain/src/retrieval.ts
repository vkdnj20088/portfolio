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

/** 질의를 코퍼스 전체에 대해 채점해 상위 결과를 반환. mode 로 정렬 기준(시맨틱/키워드)을 바꾼다. */
export function search(query: string, mode: SearchMode = 'semantic', limit = 8): ScoredPassage[] {
  const hits = CORPUS_INDEX.search(query, mode, limit);
  const out: ScoredPassage[] = [];
  for (const hit of hits) {
    const passage = PASSAGE_BY_ID.get(hit.id);
    if (!passage) continue;
    const doc = DOC_BY_ID.get(passage.docId);
    out.push({
      passage,
      docTitle: doc?.title ?? passage.docId,
      category: doc?.category ?? '',
      semantic: hit.semantic,
      keyword: hit.keyword,
      matched: hit.matched,
    });
  }
  return out;
}

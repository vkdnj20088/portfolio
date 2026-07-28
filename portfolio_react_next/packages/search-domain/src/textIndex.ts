import type { SearchMode } from './types';

/**
 * 결정적 텍스트 검색 엔진(§0: 실 벡터DB 없음). TF-IDF 코사인이 기본이고, "시맨틱" 모드는 질의어를
 * 동의어로 확장해 정확일치가 못 잡는 문서까지 끌어온다. 두 점수를 함께 돌려주어 대비를 시각화할 수 있다.
 * 난수 없음 -> 같은 질의는 늘 같은 결과(재현성).
 *
 * **인스턴스 팩토리인 이유.** 처음에는 코퍼스 하나를 모듈 로드 시 굽는 싱글턴이었다. 그러면 고정된
 * 문서 집합에만 쓸 수 있어, 계속 늘어나는 데이터(예: 채팅 메시지)에는 붙지 않는다. 색인을 값으로
 * 만들어 두면 "문서 집합마다 하나씩" 가질 수 있고, 정적 코퍼스는 그중 한 인스턴스가 된다.
 */

// 조사 + 흔한 서술어미(하다 계열)를 토큰 끝에서 떼어 매칭 단위를 정규화한다(형태소분석 없이 결정적).
// "연차를"->"연차", "출금할"->"출금", "필요합니다"->"필요". 겹치는 어미는 긴 것부터 와야 그리디하게 잡힌다.
const ENDINGS =
  /(했습니다|하겠습니다|되었습니다|됩니다|됩니까|되나요|합니다|습니다|하면서|되어야|되며|되는|된다|되고|되어|되나|하는|하고|하며|하여|해야|해서|했다|한다|하다|하면|인가요|은가요|으로부터|에게서|으로서|으로써|이라고|나요|까요|가요|해요|라고|까지|부터|에서|에게|한테|보다|처럼|마다|밖에|조차|마저|이나|으로|로서|로써|이라|해|했|하|할|함|을|를|이|가|은|는|에|의|와|과|도|만|로|께)$/;

function normToken(raw: string): string {
  if (/^[가-힣]/.test(raw) && raw.length > 1) {
    const stripped = raw.replace(ENDINGS, '');
    // 스템이 2자 이상일 때만 어미로 인정해 뗀다. 이 가드가 없으면 "휴가"(가=조사)를 "휴"로,
    // "이하"(하=X) 등 단어를 망가뜨린다 - 안전하게 오버스트립을 막는다. 색인·질의에 동일 적용(정합).
    return stripped.length >= 2 ? stripped : raw;
  }
  return raw;
}

/** 색인 측 토크나이즈. 상태가 없어 인스턴스 밖에서도 쓴다(문장 채점 등). */
export function tokenize(text: string): string[] {
  const matched = text.toLowerCase().match(/[가-힣]+|[a-z0-9]+/g) ?? [];
  return matched.map(normToken).filter((t) => t.length > 0);
}

// 동의어 - 시맨틱 확장용. 키워드 모드는 확장하지 않아, 사용자가 "휴가"로 물어도 "연차" 문단을 놓친다(대비 시연).
export const DEFAULT_SYNONYMS: Record<string, string[]> = {
  휴가: ['연차', '반차', '병가', '유급휴가'],
  연차: ['휴가', '유급휴가'],
  반차: ['휴가', '연차'],
  병가: ['휴가'],
  암호: ['비밀번호', '패스워드'],
  비밀번호: ['암호', '패스워드'],
  패스워드: ['비밀번호', '암호'],
  출금: ['인출', '입출금'],
  입금: ['입출금'],
  재택: ['원격', '재택근무'],
  재택근무: ['원격', '재택'],
  원격: ['재택', '재택근무'],
  주문: ['매수', '매도', '체결'],
  체결: ['주문'],
  배포: ['릴리스', '릴리즈'],
  장애: ['온콜', '인시던트', '사고'],
  로그인: ['접속', '인증'],
  노트북: ['장비', 'pc'],
  차단: ['차단목록', '블록'],
  경비: ['정산', '비용', '영수증'],
  정산: ['경비', '청구', '영수증'],
  비용: ['경비', '정산'],
  영수증: ['경비', '정산'],
  교육: ['자기계발', '세미나', '강의'],
  자기계발: ['교육', '강의', '도서'],
  출장: ['교통비', '숙박비'],
  식대: ['식비', '회식'],
  중지: ['취소', '중단'],
  대화방: ['채팅방', '대화'],
};

/** 색인 대상 문서 한 건 - 엔진이 아는 것은 id 와 텍스트뿐이다(도메인 모양은 호출자 몫). */
export interface IndexedDoc {
  id: string;
  text: string;
}

/** 채점된 문서. 두 점수를 함께 실어 "키워드 vs 시맨틱" 대비를 소비 측이 그릴 수 있게 한다. */
export interface ScoredDoc {
  id: string;
  semantic: number;
  keyword: number;
  /** 이 문서에서 실제로 매칭된 질의어(그 모드가 쓴 것만) - 하이라이트용. */
  matched: string[];
}

export interface TextIndex {
  readonly size: number;
  search(query: string, mode?: SearchMode, limit?: number): ScoredDoc[];
  /** 질의 전용 토크나이즈(사전 가드형). */
  tokenizeQuery(text: string): string[];
  /** 용어의 희소성(IDF). 흔한 말에 점수를 주지 않으려는 소비자가 공유한다. */
  idfOf(term: string): number;
  /** 대칭 폐포까지 반영된 동의어 확장 결과. */
  expansionsOf(term: string): string[];
}

interface QueryTerm {
  term: string;
  weight: number;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * 사전을 대칭 폐포로 닫는다. 손으로 쓴 사전은 한쪽 방향만 적기 쉬운데(`출금 -> 인출`), 정작 사용자는
 * 반대쪽(구어/외래어)으로 묻는다("인출할 때 뭐가 필요해?"). 대칭을 코드로 강제해 그 비대칭을 없앤다.
 */
function buildExpansion(synonyms: Record<string, string[]>): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (a === b) return;
    const set = map.get(a) ?? new Set<string>();
    set.add(b);
    map.set(a, set);
  };
  for (const [term, syns] of Object.entries(synonyms)) {
    for (const syn of syns) {
      link(term, syn);
      link(syn, term);
    }
  }
  return map;
}

/** 문서 집합 하나에 대한 색인을 만든다(결정적, 생성 시 1회 계산). */
export function createIndex(
  docs: IndexedDoc[],
  options?: { synonyms?: Record<string, string[]> },
): TextIndex {
  const expansion = buildExpansion(options?.synonyms ?? DEFAULT_SYNONYMS);

  const n = docs.length;
  const df = new Map<string, number>();
  const docTokens = new Map<string, string[]>();
  for (const d of docs) {
    const toks = tokenize(d.text);
    docTokens.set(d.id, toks);
    for (const t of new Set(toks)) df.set(t, (df.get(t) ?? 0) + 1);
  }

  function idf(term: string): number {
    return Math.log(n / (1 + (df.get(term) ?? 0))) + 1; // +1 스무딩(전 문서 등장어도 0 이하로 안 죽게)
  }

  // 문서별 tf-idf 벡터 + 노름.
  const vectors = new Map<string, { vec: Map<string, number>; norm: number }>();
  for (const d of docs) {
    const toks = docTokens.get(d.id) ?? [];
    const tf = new Map<string, number>();
    for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
    const vec = new Map<string, number>();
    let sq = 0;
    for (const [t, c] of tf) {
      const w = c * idf(t);
      vec.set(t, w);
      sq += w * w;
    }
    vectors.set(d.id, { vec, norm: Math.sqrt(sq) || 1 });
  }

  /**
   * 색인 어휘. 질의 정규화의 "사전 가드"로 쓴다.
   *
   * 어미 절단은 규칙일 뿐이라 맨 명사를 잘못 자를 수 있다 - `와이파이`의 끝 `이`를 조사로 보고 `와이파`로,
   * `지정가`를 `지정`으로 만든다. 색인에는 활용형(`와이파이는`->`와이파이`)이 들어가 있으니, 질의어가 색인
   * 어휘에 그대로 있으면 자르지 않는 것만으로 이 비대칭이 사라진다. 사전이 규칙을 이기게 하는 구조다.
   */
  const vocab = new Set<string>();
  for (const toks of docTokens.values()) for (const t of toks) vocab.add(t);

  function tokenizeQuery(text: string): string[] {
    const matched = text.toLowerCase().match(/[가-힣]+|[a-z0-9]+/g) ?? [];
    return matched
      .map((raw) => {
        if (vocab.has(raw)) return raw; // 색인에 그대로 있는 말은 자르지 않는다(과절단 방지)
        const stripped = normToken(raw);
        return vocab.has(stripped) ? stripped : raw;
      })
      .filter((t) => t.length > 0);
  }

  function expandQuery(tokens: string[], mode: SearchMode): QueryTerm[] {
    const seen = new Map<string, number>();
    for (const t of tokens) {
      seen.set(t, Math.max(seen.get(t) ?? 0, 1));
      if (mode === 'semantic') {
        for (const syn of expansion.get(t) ?? []) {
          // 동의어는 원어보다 낮은 가중치(0.5) - "정확히 물은 말"이 우선.
          seen.set(syn, Math.max(seen.get(syn) ?? 0, 0.5));
        }
      }
    }
    return [...seen.entries()].map(([term, weight]) => ({ term, weight }));
  }

  function cosine(query: QueryTerm[], docId: string): number {
    const dv = vectors.get(docId);
    if (!dv) return 0;
    let dot = 0;
    let qsq = 0;
    for (const { term, weight } of query) {
      const qw = weight * idf(term);
      qsq += qw * qw;
      const pw = dv.vec.get(term);
      if (pw) dot += qw * pw;
    }
    const qnorm = Math.sqrt(qsq) || 1;
    return dot / (qnorm * dv.norm);
  }

  return {
    get size() {
      return n;
    },

    tokenizeQuery,
    idfOf: idf,
    expansionsOf: (term) => [...(expansion.get(term) ?? [])],

    search(query, mode = 'semantic', limit = 8): ScoredDoc[] {
      const tokens = tokenizeQuery(query);
      if (tokens.length === 0) return [];
      // 질의 벡터는 루프 불변식이다 - 문서마다 다시 만들지 않는다.
      const semanticQ = expandQuery(tokens, 'semantic');
      const keywordQ = expandQuery(tokens, 'keyword');
      const scored = docs.map((d): ScoredDoc => {
        const docToks = new Set(docTokens.get(d.id) ?? []);
        // 하이라이트는 "그 모드가 실제로 쓴 질의어"만 칠한다. 키워드 모드에서 동의어를 칠하면
        // 두 모드의 시각적 증거가 같아져, 대비 화면의 존재 이유가 무너진다.
        const matched = (mode === 'semantic' ? semanticQ : keywordQ)
          .map((q) => q.term)
          .filter((t) => docToks.has(t));
        return {
          id: d.id,
          semantic: round(cosine(semanticQ, d.id)),
          keyword: round(cosine(keywordQ, d.id)),
          matched,
        };
      });
      const key = mode === 'semantic' ? (s: ScoredDoc) => s.semantic : (s: ScoredDoc) => s.keyword;
      return scored
        .filter((s) => key(s) > 0)
        .sort((a, b) => key(b) - key(a) || a.id.localeCompare(b.id))
        .slice(0, limit);
    },
  };
}

'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { ALL_PASSAGES, CORPUS, type ScoredPassage, type SearchMode } from '@chat/search-domain';
import { AppShell } from '@/components/AppShell';
import { Metrics } from '@/components/Metrics';
import { docqa } from '@/lib/docqa';
import { TermHighlight } from '@/lib/highlight';

/**
 * 점수 막대에 넘길 CSS 변수. 값(0~1)과 계단 순번을 커스텀 프로퍼티로 넘겨 길이·지연을
 * CSS 가 계산한다 - 인라인 스타일에 최종 px 을 박으면 모션 규칙이 두 곳으로 갈린다.
 * 순번은 6 에서 끊는다(공유 리빌 규칙과 동일 - 그 위는 마지막이 눈에 띄게 늦다).
 */
function barStyle(value: number, index: number): CSSProperties {
  return {
    '--v': String(Math.max(0, Math.min(1, value))),
    '--i': String(index % 6),
  } as CSSProperties;
}

const SAMPLES = ['휴가 규정', '비밀번호 변경 주기', '재택근무 신청', '경비 영수증', '주문 체결'];
const CORPUS_SIZE = ALL_PASSAGES.length;
const DOC_COUNT = CORPUS.length;

/** 한 번의 검색에서 측정된 값(관측 배지용). */
interface SearchMetrics {
  ms: number;
  count: number;
  /** 키워드 점수가 0인 결과 = 동의어 확장이 없었다면 아예 못 찾았을 문단. */
  semanticOnly: number;
}

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<SearchMode>('semantic');
  const [results, setResults] = useState<ScoredPassage[] | null>(null);
  /**
   * 카테고리 패싯(#D2). 직전까지 카테고리는 결과에 <b>표시만</b> 됐다 - 보이는데 누를 수 없는
   * 정보였다. 색인이 인메모리라 카운트가 공짜이므로 개수까지 함께 보여 준다("필터가 있다"와
   * "색인 통계를 안다"는 다르게 읽힌다).
   */
  const [facet, setFacet] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<SearchMetrics | null>(null);

  /**
   * URL -> 상태 복원(딥링크 수신). 링크를 공유했는데 열면 빈 화면이면 딥링크가 아니다.
   *
   * useEffect 로 마운트 1회만 도는 이유: 서버 렌더에는 location 이 없고, 검색은 클라이언트에서만
   * 도는 계산이다. 의존성이 빈 배열이라 이후 사용자 조작을 되돌리지 않는다(URL 은 syncUrl 이
   * 한 방향으로만 갱신한다 - 양방향으로 묶으면 조작과 복원이 서로를 덮는다).
   */
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const q = (p.get('q') ?? '').trim();
    const m: SearchMode = p.get('mode') === 'keyword' ? 'keyword' : 'semantic';
    const cat = p.get('cat');
    if (!q) return;
    setMode(m);
    // run() 은 패싯을 초기화하므로 먼저 검색하고 나서 카테고리를 얹는다.
    run(q, m);
    if (cat) {
      setFacet(cat);
      syncUrl(q, m, cat);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 마운트 1회 복원(위 주석 참고)
  }, []);

  /**
   * URL 에 검색 상태를 반영한다(딥링크). replaceState 를 쓰는 이유: 검색은 페이지 이동이 아니라
   * 같은 화면의 상태 변경이라, pushState 로 쌓으면 뒤로가기가 검색 히스토리를 한 칸씩 되짚는
   * 도구가 되어 "이전 페이지로" 라는 기대를 깬다.
   */
  function syncUrl(q: string, m: SearchMode, cat: string | null) {
    if (typeof window === 'undefined') return;
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (m !== 'semantic') p.set('mode', m);
    if (cat) p.set('cat', cat);
    const qs = p.toString();
    window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
  }

  function run(q: string, m: SearchMode) {
    const trimmed = q.trim();
    if (!trimmed) {
      setResults(null);
      setMetrics(null);
      return;
    }
    setQuery(trimmed);
    const startedAt = performance.now();
    const found = docqa.search(trimmed, m);
    const ms = performance.now() - startedAt;
    setResults(found);
    // 새 질의에는 이전 패싯을 들고 가지 않는다 - 결과 집합이 통째로 바뀌었는데 필터가 남아 있으면
    // "0건"이 검색 실패로 읽힌다(실제로는 필터 때문인데).
    setFacet(null);
    syncUrl(trimmed, m, null);
    setMetrics({
      ms,
      count: found.length,
      semanticOnly: found.filter((r) => r.keyword === 0).length,
    });
  }

  function switchMode(m: SearchMode) {
    setMode(m);
    if (query.trim()) run(query, m);
    else syncUrl(query.trim(), m, facet);
  }

  function toggleFacet(cat: string) {
    const next = facet === cat ? null : cat;
    setFacet(next);
    syncUrl(query.trim(), mode, next);
  }

  /**
   * 카테고리별 개수 - 결과에서 파생한다. 색인이 인메모리라 이 집계는 사실상 공짜다.
   * 개수가 많은 순으로 정렬해 사용자가 큰 덩어리부터 좁힐 수 있게 한다.
   */
  const facets: [string, number][] = (() => {
    if (!results) return [];
    const counts = new Map<string, number>();
    for (const r of results) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'));
  })();

  /** 화면에 그리는 결과. 패싯은 순위를 바꾸지 않고 걸러내기만 한다(랭킹은 검색이 정한다). */
  const shown = facet && results ? results.filter((r) => r.category === facet) : (results ?? []);

  return (
    <AppShell>
      <div className="page">
        <div className="pageHead">
          <h1>시맨틱 검색</h1>
          <p>
            사내 동의어 사전으로 질의어를 확장한 <b>어휘 랭킹(TF-IDF 코사인)</b>으로 문단을
            찾습니다. 임베딩 없이 결정적으로 도는 대신, 확장이 실제로 값을 하는지는{' '}
            <a href="/eval">품질 지표</a>에서 키워드 모드와 같은 골드셋으로 비교합니다.
          </p>
        </div>

        <form
          className="askForm"
          onSubmit={(e) => {
            e.preventDefault();
            run(query, mode);
          }}
        >
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="사내 문서를 검색하세요"
            aria-label="검색어 입력"
          />
          <button type="submit" className="primaryBtn">
            검색
          </button>
        </form>

        <div className="samples" role="group" aria-label="예시 검색어">
          {SAMPLES.map((s) => (
            <button key={s} type="button" className="sampleChip" onClick={() => run(s, mode)}>
              {s}
            </button>
          ))}
        </div>

        <div className="modeRow">
          <div className="segmented" role="group" aria-label="검색 방식">
            <button
              type="button"
              aria-pressed={mode === 'semantic'}
              onClick={() => switchMode('semantic')}
            >
              시맨틱
            </button>
            <button
              type="button"
              aria-pressed={mode === 'keyword'}
              onClick={() => switchMode('keyword')}
            >
              키워드
            </button>
          </div>
          <span className="modeHint">
            {mode === 'semantic'
              ? '동의어 확장 랭킹 - "휴가"로 물어도 연차/반차 문단까지 찾아냅니다.'
              : '정확 일치 랭킹 - 같은 단어가 없으면 관련 문단을 놓칩니다.'}
          </span>
        </div>

        {metrics && (
          <>
            <h2 className="srOnly">검색 관측 지표</h2>
            <Metrics
              label="검색 관측 지표"
              note={`색인은 가상 사내문서 ${DOC_COUNT}건 ${CORPUS_SIZE}문단. 사전 계산한 인메모리 TF-IDF 벡터를 쓰기 때문에 네트워크 왕복이 없습니다.`}
              items={[
                { k: '검색 지연', v: `${metrics.ms.toFixed(1)}ms` },
                { k: '결과', v: `${metrics.count}개 문단` },
                {
                  k: '동의어로만 찾은 문단',
                  v: `${metrics.semanticOnly}개`,
                  tone: metrics.semanticOnly > 0 ? 'ok' : 'muted',
                },
              ]}
            />
          </>
        )}

        {results !== null &&
          (results.length === 0 ? (
            <div className="empty">일치하는 문서를 찾지 못했습니다.</div>
          ) : (
            <>
              <h2 className="resultCount" role="status">
                {shown.length}개 문단 · {mode === 'semantic' ? '시맨틱' : '키워드'} 순
                {facet && <span className="facetActive"> · {facet} 필터</span>}
              </h2>

              {/* 패싯(#D2) - 카테고리별 개수를 함께 준다. 결과가 하나뿐인 카테고리만 있으면
                  필터가 하는 일이 없으므로 두 종류 이상일 때만 노출한다. */}
              {facets.length > 1 && (
                <div className="facets" role="group" aria-label="카테고리 필터">
                  {facets.map(([cat, n]) => (
                    <button
                      key={cat}
                      type="button"
                      className="facetChip"
                      aria-pressed={facet === cat}
                      onClick={() => toggleFacet(cat)}
                    >
                      {cat} <span className="facetCount">{n}</span>
                    </button>
                  ))}
                </div>
              )}

              <ol className="results" role="list">
                {shown.map((r, i) => (
                  <li key={r.passage.id} className={`result${i === 0 ? ' featured' : ''}`}>
                    <div className="rhead">
                      {i === 0 && <span className="featuredTag">최상위</span>}
                      <span className="doc">{r.docTitle}</span>
                      <span className="cat">{r.category}</span>
                    </div>
                    <p className="text">
                      <TermHighlight text={r.passage.text} terms={r.matched} />
                    </p>
                    {r.keyword === 0 && (
                      <span className="srOnly">
                        동의어 확장으로만 찾은 문단입니다. 키워드 검색으로는 나오지 않습니다.
                      </span>
                    )}
                    <div className="scores">
                      <div className="scoreItem">
                        <span className="k">
                          <span>시맨틱</span>
                          <span>{r.semantic.toFixed(3)}</span>
                        </span>
                        {/* 길이는 --v(0~1), 계단 순번은 --i 로 넘긴다. 폭을 width 가 아니라
                            scaleX 로 그리는 이유는 globals.css 의 .bar > i 주석 참고. */}
                        <span className="bar semantic" aria-hidden="true">
                          <i style={barStyle(r.semantic, i)} />
                        </span>
                      </div>
                      <div className="scoreItem">
                        <span className="k">
                          <span>키워드</span>
                          <span>{r.keyword.toFixed(3)}</span>
                        </span>
                        <span className="bar keyword" aria-hidden="true">
                          <i style={barStyle(r.keyword, i)} />
                        </span>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </>
          ))}
      </div>
    </AppShell>
  );
}

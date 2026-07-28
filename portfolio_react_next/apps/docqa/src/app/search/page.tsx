'use client';

import { useState } from 'react';
import { ALL_PASSAGES, CORPUS, type ScoredPassage, type SearchMode } from '@chat/search-domain';
import { AppShell } from '@/components/AppShell';
import { Metrics } from '@/components/Metrics';
import { docqa } from '@/lib/docqa';
import { TermHighlight } from '@/lib/highlight';

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
  const [metrics, setMetrics] = useState<SearchMetrics | null>(null);

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
    setMetrics({
      ms,
      count: found.length,
      semanticOnly: found.filter((r) => r.keyword === 0).length,
    });
  }

  function switchMode(m: SearchMode) {
    setMode(m);
    if (query.trim()) run(query, m);
  }

  return (
    <AppShell>
      <div className="page">
        <div className="pageHead">
          <h1>시맨틱 검색</h1>
          <p>
            사내 동의어 사전으로 질의어를 확장한 <b>어휘 랭킹(TF-IDF 코사인)</b>으로 문단을 찾습니다.
            임베딩 없이 결정적으로 도는 대신, 확장이 실제로 값을 하는지는{' '}
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
                {results.length}개 문단 · {mode === 'semantic' ? '시맨틱' : '키워드'} 순
              </h2>
              <ol className="results" role="list">
                {results.map((r, i) => (
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
                        <span className="bar semantic" aria-hidden="true">
                          <i style={{ width: `${Math.min(100, r.semantic * 100)}%` }} />
                        </span>
                      </div>
                      <div className="scoreItem">
                        <span className="k">
                          <span>키워드</span>
                          <span>{r.keyword.toFixed(3)}</span>
                        </span>
                        <span className="bar keyword" aria-hidden="true">
                          <i style={{ width: `${Math.min(100, r.keyword * 100)}%` }} />
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

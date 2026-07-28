'use client';

import { useRef, useState } from 'react';
import { MRC_TOP_K, verifyGrounding, type Answer } from '@chat/search-domain';
import { AppShell } from '@/components/AppShell';
import { Metrics, type Metric } from '@/components/Metrics';
import { docqa, type Transport } from '@/lib/docqa';
import { SpanHighlight } from '@/lib/highlight';

type Status = 'idle' | 'streaming' | 'answered' | 'none' | 'error';

/** 한 번의 질의응답에서 실제로 측정된 값들(관측 배지에 그대로 노출). */
interface RunMetrics {
  candidates: number;
  ranked: number;
  read: number;
  retrievalMs: number;
  firstTokenMs: number | null;
  transport: Transport;
  transportNote?: string;
}

/** 검색 후보 폭(랭킹 상위 몇 개까지 보여주는가) - 화면 파이프라인 표기와 검색 화면이 같은 값을 쓴다. */
const RANK_WIDTH = 8;

const SAMPLES = [
  '연차는 며칠 부여되나요?',
  '비밀번호는 몇 자 이상이어야 하나요?',
  '경비 정산은 언제까지 해야 하나요?',
  '세미나 참가비도 지원되나요?',
];

/** 코퍼스에 답이 없는 질문들 - 지어내지 않고 침묵하는지 직접 눌러 확인하라고 따로 배치한다. */
const NEGATIVE_SAMPLES = ['주차장은 몇 시까지 운영하나요?', '육아휴직은 얼마나 쓸 수 있나요?'];

export default function QaPage() {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [streamText, setStreamText] = useState('');
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [metrics, setMetrics] = useState<RunMetrics | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function ask(q: string) {
    const trimmed = q.trim();
    if (!trimmed) return;
    setQuery(trimmed);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus('streaming');
    setStreamText('');
    setAnswer(null);
    setMetrics(null);

    // 리트리벌 단계를 눈에 보이게 계측한다. 검색 엔진이 결정적이라 서버가 고르는 후보와 정확히 같다.
    const retrievalStart = performance.now();
    const all = docqa.search(trimmed, 'semantic', 999);
    const retrievalMs = performance.now() - retrievalStart;

    const startedAt = performance.now();
    let firstTokenMs: number | null = null;
    let transport: Transport = 'sse';
    let transportNote: string | undefined;

    try {
      for await (const ev of docqa.streamAnswer(trimmed, {
        signal: controller.signal,
        onTransport: (t, note) => {
          transport = t;
          transportNote = note;
        },
      })) {
        if (ev.type === 'delta') {
          if (firstTokenMs === null) firstTokenMs = performance.now() - startedAt;
          setStreamText((prev) => prev + ev.text);
        } else {
          setAnswer(ev.answer);
          setStatus(ev.answer ? 'answered' : 'none');
          setMetrics({
            candidates: all.length,
            ranked: Math.min(all.length, RANK_WIDTH),
            read: Math.min(all.length, MRC_TOP_K),
            retrievalMs,
            firstTokenMs,
            transport,
            transportNote,
          });
        }
      }
    } catch {
      // 중단은 실패가 아니다. 그 밖의 예외는 "정답 없음"과 구분해서 보여준다 - 인프라 실패를
      // 도메인 결과로 둔갑시키면, 정직함을 파는 이 데모가 스스로를 배신한다.
      if (!controller.signal.aborted) setStatus('error');
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  const liveMessage =
    status === 'streaming'
      ? '답변을 찾고 있습니다.'
      : status === 'answered' && answer
        ? `답변: ${answer.text} 출처: ${answer.docTitle}, ${answer.category}. 질의 일치도 ${Math.round(answer.confidence * 100)}퍼센트.`
        : status === 'none'
          ? '충분한 근거를 찾지 못해 답변하지 않았습니다.'
          : status === 'error'
            ? '답변을 가져오지 못했습니다.'
            : '';

  return (
    <AppShell>
      <div className="page">
        <div className="pageHead">
          <h1>문서 근거 QA</h1>
          <p>
            사내 문서(더미 코퍼스)에서 <b>근거 문장을 그대로 인용해</b> 답합니다. 답을 생성하지 않고
            원문에서 오려내므로 <b>없는 말을 지어내지 않고</b>, 근거가 약하면 답하지 않습니다. 다만 근거
            문장을 잘못 고를 수는 있어, 그 비율까지 <a href="/eval">품질 지표</a>에 공개합니다.
          </p>
        </div>

        <form
          className="askForm"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(query);
          }}
        >
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="사내 규정·매뉴얼에 대해 물어보세요"
            aria-label="질문 입력"
          />
          <button type="submit" className="primaryBtn">
            질문 보내기
          </button>
        </form>

        <div className="samples" role="group" aria-label="예시 질문">
          {SAMPLES.map((s) => (
            <button key={s} type="button" className="sampleChip" onClick={() => void ask(s)}>
              {s}
            </button>
          ))}
          {NEGATIVE_SAMPLES.map((s) => (
            <button
              key={s}
              type="button"
              className="sampleChip negative"
              onClick={() => void ask(s)}
            >
              {s}
              <span className="srOnly"> (코퍼스에 답이 없는 질문)</span>
            </button>
          ))}
        </div>
        <p className="samplesHint">
          뒤쪽 두 개는 <b>코퍼스에 답이 없는 질문</b>입니다. 그럴듯한 문장을 내미는 대신 답하지 않는지
          확인해 보세요.
        </p>

        {/* 낭독 전용. 흐르는 텍스트를 라이브 리전에 두면 어절마다 전체가 다시 읽힌다(수십 회). */}
        <p className="srOnly" role="status">
          {liveMessage}
        </p>

        {status !== 'idle' && (
          <section className="answerCard" aria-label="답변">
            <div className="answerHead">
              <span className="label">답변</span>
              {status === 'answered' && answer && (
                <span className="confidence">
                  질의 일치도 <b>{Math.round(answer.confidence * 100)}%</b>
                </span>
              )}
            </div>

            <div className="answerBody" aria-busy={status === 'streaming'}>
              {status === 'streaming' && (
                <>
                  {streamText === '' ? (
                    <span className="loading">
                      <span className="dots" aria-hidden="true">
                        <i />
                        <i />
                        <i />
                      </span>
                      문서를 찾는 중
                    </span>
                  ) : (
                    <>
                      {streamText}
                      <span className="caret" aria-hidden="true" />
                    </>
                  )}
                </>
              )}
              {status === 'answered' && answer && answer.text}
              {status === 'none' && (
                <span className="noAnswer">
                  이 질문에 답할 근거를 코퍼스에서 찾지 못했습니다. 그럴듯한 문장을 지어내는 대신 답하지
                  않습니다.
                </span>
              )}
              {status === 'error' && (
                <span className="noAnswer">
                  답변을 가져오지 못했습니다(전송 오류). 근거가 없다는 뜻은 아닙니다 - 다시 시도해
                  주세요.
                </span>
              )}
            </div>

            {status === 'answered' && answer && (
              <div className="evidence">
                <h2 className="srOnly">근거</h2>
                <div className="cite">
                  <span className="doc">{answer.docTitle}</span>
                  <span className="cat">{answer.category}</span>
                  <span className="docId">{answer.docId}</span>
                </div>
                <p className="passage">
                  <SpanHighlight
                    text={answer.passageText}
                    start={answer.spanStart}
                    end={answer.spanEnd}
                  />
                </p>
              </div>
            )}

            {metrics && (
              <div className="metricsWrap">
                <h2 className="srOnly">관측 지표</h2>
                <Metrics
                  items={metricItems(metrics, answer)}
                  label="이번 응답 관측 지표"
                  note={noteFor(metrics)}
                />
              </div>
            )}
          </section>
        )}
      </div>
    </AppShell>
  );
}

function metricItems(m: RunMetrics, answer: Answer | null): Metric[] {
  const grounding = verifyGrounding(answer);
  const items: Metric[] = [
    { k: '파이프라인', v: `후보 ${m.candidates} → 상위 ${m.ranked} → 독해 ${m.read}` },
    { k: '검색', v: `${m.retrievalMs.toFixed(1)}ms` },
    { k: '첫 응답', v: m.firstTokenMs === null ? '-' : `${Math.round(m.firstTokenMs)}ms` },
    {
      k: '전송',
      v: m.transport === 'sse' ? 'SSE' : 'mock 대체',
      tone: m.transport === 'sse' ? undefined : 'muted',
    },
  ];
  if (answer) {
    items.push({
      k: '근거 검증',
      v: grounding.verbatim
        ? `원문과 글자 단위 일치 · 인용 범위 ${Math.round(grounding.spanRatio * 100)}%`
        : '불일치(생성 의심)',
      tone: grounding.verbatim ? 'ok' : undefined,
    });
  }
  return items;
}

function noteFor(m: RunMetrics): string {
  const pacing =
    '어절 간격 45ms 는 체감용 고정값이라 총 소요는 답변 길이에 비례합니다(측정값이 아닙니다). 검색 지연과 근거 검증은 실측입니다.';
  return m.transport === 'sse'
    ? `POST /api/answer 를 text/event-stream 으로 소비했습니다. ${pacing}`
    : `SSE 전송이 실패해 인메모리 대체 경로로 이어받았습니다(${m.transportNote ?? '사유 미상'}). ${pacing}`;
}

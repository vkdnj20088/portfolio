'use client';

import { useMemo, useState } from 'react';
import {
  CONFIDENCE_THRESHOLD,
  compareLlmBaseline,
  evaluate,
  hasLlmBaseline,
  staleCases,
} from '@chat/search-domain';
import type { LlmComparisonRow } from '@chat/search-domain';
import { AppShell } from '@/components/AppShell';

/**
 * 품질 지표 화면. "시맨틱이 키워드보다 낫다", "지어내지 않는다" 같은 주장을 화면 문구가 아니라
 * 골드셋 측정치로 보여준다. 잘 되는 것만 고르지 않고 오답과 과잉 불응답까지 같은 표에 남기는 것이 요점.
 *
 * 서버 컴포넌트로 뒀다가 다른 두 라우트와 같은 클라이언트 컴포넌트로 되돌렸다. 이 앱은 nonce 때문에
 * 전 라우트가 force-dynamic 인데, 그 상태에서 서버 컴포넌트 페이지는 Next 가 메타데이터를 셸 뒤로
 * 흘려보낸다(스트리밍 메타데이터). 브라우저는 하이드레이션 때 head 로 끌어올리지만, 초기 HTML 만 읽는
 * 소비자(감사 도구·일부 크롤러)에게는 description 이 없는 문서로 보였다 - 실측으로 확인하고 되돌렸다.
 */
// 평가는 결정적이라 렌더마다 다시 돌릴 이유가 없다. 모듈 로드 시 1회만 계산한다(수 ms).
const REPORT = evaluate();

export default function EvalPage() {
  const report = REPORT;
  const { semantic, keyword } = report.retrieval;
  const wrong = report.answer.answered - report.answer.correct;
  const rows = report.rows;

  return (
    <AppShell>
      <div className="page">
        <div className="pageHead">
          <h1>품질 지표</h1>
          <p>
            직접 라벨링한 <b>골드셋 {report.cases}문항</b>(문서 어휘 그대로 / 동의어로만 / 코퍼스에
            답 없음)으로 검색·독해·불응답을 측정합니다. 엔진이 결정적이라 같은 코드는 늘 같은 표를
            냅니다 - 그래서 이 수치는 테스트에서 <b>회귀 게이트</b>로도 씁니다.
          </p>
          <p className="evalNote">
            이 표에 반복 측정이 없는 것은 필요가 없어서입니다. 같은 입력에 분산이 0이라 값이 바뀌면
            그대로 회귀입니다. 반복과 통계가 필요한 쪽은 모델 왕복이 낀 시스템이고, 그건{' '}
            <a href="/agent/eval">에이전트 평가 화면</a>에서 다룹니다 - 거기서는 값이 바뀌어도
            회귀가 아닐 수 있습니다.
          </p>
        </div>

        <h2 className="evalH2">검색 - 동의어 확장은 값을 하는가</h2>
        <div className="tableWrap">
          <table className="evalTable">
            <caption className="srOnly">검색 모드별 정확도 비교</caption>
            <thead>
              <tr>
                <th scope="col">모드</th>
                <th scope="col">Recall@1</th>
                <th scope="col">Recall@3</th>
                <th scope="col">Recall@5</th>
                <th scope="col">MRR</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">시맨틱(동의어 확장)</th>
                <td className="win">{pct(semantic.recall1)}</td>
                <td className="win">{pct(semantic.recall3)}</td>
                <td className="win">{pct(semantic.recall5)}</td>
                <td className="win">{semantic.mrr.toFixed(3)}</td>
              </tr>
              <tr>
                <th scope="row">키워드(정확 일치)</th>
                <td>{pct(keyword.recall1)}</td>
                <td>{pct(keyword.recall3)}</td>
                <td>{pct(keyword.recall5)}</td>
                <td>{keyword.mrr.toFixed(3)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="evalNote">
          답이 있는 {semantic.n}문항 기준. 두 모드에 같은 질의를 넣고 정답 문단의 순위를 비교합니다.
        </p>

        <h2 className="evalH2">독해와 불응답 - 지어내지 않는가</h2>
        <div className="evalCards">
          <div className="evalCard">
            <span className="ev">{pct(report.abstention.rate)}</span>
            <span className="ek">불응답 정확도</span>
            <span className="ed">
              답이 없어야 하는 {report.abstention.n}문항 중 실제로 침묵한 비율. 이 데모가 파는
              지표라 100% 아래로 내려가면 테스트가 깨집니다.
            </span>
          </div>
          <div className="evalCard">
            <span className="ev">{pct(report.answer.accuracy)}</span>
            <span className="ek">답변 정확도</span>
            <span className="ed">
              답이 있는 {report.answer.n}문항 중 정답 문단을 인용한 비율. 침묵도 실패로 세는 엄격한
              기준입니다.
            </span>
          </div>
          <div className="evalCard">
            <span className="ev">{wrong}건</span>
            <span className="ek">오답(틀린 근거로 답함)</span>
            <span className="ed">
              가장 나쁜 실패. 근거를 붙였지만 그 근거가 질문의 답이 아닌 경우입니다.
            </span>
          </div>
          <div className="evalCard">
            <span className="ev">{report.abstention.overAbstained}건</span>
            <span className="ek">과잉 불응답</span>
            <span className="ed">
              답이 있는데 확신이 부족해 침묵한 경우. 임계값({CONFIDENCE_THRESHOLD})을 올리면 오답이
              줄고 이 수가 늡니다 - 데모는 오답을 더 나쁜 실패로 보고 침묵 쪽에 섰습니다.
            </span>
          </div>
        </div>

        <ThresholdSweep />

        <LlmContrast />

        <h2 className="evalH2">문항별 상세</h2>
        <div className="tableWrap">
          <table className="evalTable">
            <caption className="srOnly">골드셋 문항별 검색 순위와 답변 결과</caption>
            <thead>
              <tr>
                <th scope="col">질문</th>
                <th scope="col">유형</th>
                <th scope="col">시맨틱 순위</th>
                <th scope="col">키워드 순위</th>
                <th scope="col">결과</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.q}>
                  <th scope="row" className="q">
                    {r.q}
                  </th>
                  <td>{splitLabel(r.split)}</td>
                  <td>{rankLabel(r.semanticRank)}</td>
                  <td>{rankLabel(r.keywordRank)}</td>
                  <td className={r.ok ? 'ok' : 'bad'}>{outcome(r.gold, r.answered, r.ok)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function rankLabel(rank: number | null): string {
  if (rank === null) return '-';
  return `${rank}위`;
}

function splitLabel(split: string): string {
  if (split === 'exact') return '문서 어휘';
  if (split === 'paraphrase') return '동의어';
  return '답 없음';
}

function outcome(gold: string | null, answered: string | null, ok: boolean): string {
  if (gold === null) return ok ? '침묵(정답)' : `지어냄 ${answered}`;
  if (answered === null) return '침묵(과잉)';
  return ok ? '정답' : `오답 ${answered}`;
}

/**
 * LLM 독해 대조군.
 *
 * 이 데모는 "답을 생성하지 않고 코퍼스에서 추출하므로 구조적으로 지어내지 않는다"고 말한다.
 * 구조로 얻은 성질이라면 같은 문제를 생성 모델에 시켰을 때 무엇이 달라지는지를 같은 골드셋으로
 * 보여야 그 말이 선다. 그래서 이 절은 **우열표가 아니다** - 어느 쪽이 낫다가 아니라 무엇이
 * 다른가를 본다. LLM 이 더 맞힌 문항도 같은 표에 그대로 남긴다(그것을 감추면 이 데모가 파는
 * 정직함과 어긋난다).
 *
 * 대조는 검색을 고정하고 읽기만 바꾼다 - 양쪽 모두 같은 semantic 상위 5건을 받는다.
 * 그래서 차이는 검색 품질이 아니라 독해·불응답 판단에서 온다.
 *
 * 배포에 키가 없으므로(§0) 런타임 호출은 없다. 키를 가진 사람이 한 번 수집해 커밋한 판정을
 * 재생할 뿐이고, 수집 전이면 그 사실을 그대로 적는다.
 */
function LlmContrast() {
  const cmp = useMemo(() => compareLlmBaseline(REPORT), []);
  const stale = useMemo(() => staleCases(), []);

  if (!hasLlmBaseline()) {
    return (
      <>
        <h2 className="evalH2">LLM 독해와의 대조 - 아직 수집 전</h2>
        <p className="evalNote">
          이 배포에는 API 키가 없습니다. 대조군은 키를 가진 사람이 골드셋 {cmp.cases}문항을 한 번
          받아 커밋한 판정을 재생하는 방식인데, 그 산출물이 아직 비어 있습니다. 실시간 호출인 척
          채워 넣는 대신 비어 있다고 적어 둡니다.
        </p>
      </>
    );
  }

  const disagreed = cmp.rows.filter((r) => r.ruleAnswered !== r.llmAnswered);
  const answerableN = cmp.rule.answered + cmp.rule.overAbstained;
  const unanswerableN = cmp.rule.abstained + cmp.rule.hallucinated;

  return (
    <>
      <h2 className="evalH2">규칙 기반 독해와 LLM 독해는 무엇이 다른가</h2>
      <p className="evalNote">
        같은 질문에 <b>같은 검색 결과</b>({cmp.mode === 'semantic' ? '시맨틱' : '키워드'} 상위{' '}
        {cmp.depth}건)를 주고 <b>읽는 쪽만</b> 바꿔 채점했습니다. 그래서 아래 차이는 검색 품질이
        아니라 독해와 불응답 판단에서 옵니다. 어느 쪽이 낫다는 표가 아니라 무엇이 다른가를 보는
        표입니다 - {cmp.covered}문항 중 판정이 갈린 것은 {cmp.disagreements}건입니다.
      </p>

      <div className="tableWrap">
        <table className="evalTable">
          <caption className="srOnly">규칙 기반 독해와 LLM 독해의 지표 대조</caption>
          <thead>
            <tr>
              <th scope="col">지표</th>
              <th scope="col">규칙 기반(배포본)</th>
              <th scope="col">LLM 베이스라인</th>
            </tr>
          </thead>
          <tbody>
            <ContrastRow
              label={`답변 정확도 (답 있는 ${answerableN}문항)`}
              rule={`${pct(cmp.rule.correct / (answerableN || 1))} (${cmp.rule.correct}건)`}
              llm={`${pct(cmp.llm.correct / (answerableN || 1))} (${cmp.llm.correct}건)`}
            />
            <ContrastRow
              label="오답 (틀린 근거로 답함)"
              rule={`${cmp.rule.wrong}건`}
              llm={`${cmp.llm.wrong}건`}
            />
            <ContrastRow
              label="과잉 불응답 (답이 있는데 침묵)"
              rule={`${cmp.rule.overAbstained}건`}
              llm={`${cmp.llm.overAbstained}건`}
            />
            <ContrastRow
              label={`올바른 침묵 (답 없는 ${unanswerableN}문항)`}
              rule={`${cmp.rule.abstained}/${unanswerableN}`}
              llm={`${cmp.llm.abstained}/${unanswerableN}`}
            />
            <ContrastRow
              label="지어냄 (답이 없는데 답함)"
              rule={`${cmp.rule.hallucinated}건`}
              llm={`${cmp.llm.hallucinated}건`}
            />
          </tbody>
        </table>
      </div>
      <p className="evalNote">
        {cmp.model} · {cmp.generatedAt.slice(0, 10)} 수집 · 골드셋 {cmp.cases}문항 중 {cmp.covered}
        문항 대조.
        {cmp.covered < cmp.cases
          ? ` 나머지 ${cmp.cases - cmp.covered}문항은 형식 밖 응답이라 수집에서 제외했습니다 - 침묵으로 세면 없는 실패를 만들게 됩니다.`
          : ''}
        {stale.length > 0
          ? ` 코퍼스가 바뀌어 후보 구성이 달라진 문항이 ${stale.length}건 있습니다 - 그만큼 이 대조는 낡았습니다.`
          : ''}
      </p>

      {disagreed.length > 0 && (
        <>
          <h3 className="evalH3">판정이 갈린 문항</h3>
          <div className="tableWrap">
            <table className="evalTable">
              <caption className="srOnly">두 경로의 판정이 갈린 문항</caption>
              <thead>
                <tr>
                  <th scope="col">질문</th>
                  <th scope="col">유형</th>
                  <th scope="col">규칙</th>
                  <th scope="col">LLM</th>
                  <th scope="col">누가 맞았나</th>
                </tr>
              </thead>
              <tbody>
                {disagreed.map((r) => (
                  <tr key={r.q}>
                    <th scope="row" className="q">
                      {r.q}
                    </th>
                    <td>{splitLabel(r.split)}</td>
                    <td className={r.ruleOk ? 'ok' : 'bad'}>{r.ruleAnswered ?? '침묵'}</td>
                    <td className={r.llmOk ? 'ok' : 'bad'}>{r.llmAnswered ?? '침묵'}</td>
                    <td>{verdictLabel(r.verdict)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="evalNote">
            정답 문단은 위 &ldquo;문항별 상세&rdquo; 표의 골드 라벨과 같습니다. 침묵이 정답인
            문항(답 없음)에서는 &ldquo;침묵&rdquo;이 맞은 판정입니다.
          </p>
        </>
      )}
    </>
  );
}

function ContrastRow({ label, rule, llm }: { label: string; rule: string; llm: string }) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td>{rule}</td>
      <td>{llm}</td>
    </tr>
  );
}

function verdictLabel(v: LlmComparisonRow['verdict']): string {
  if (v === 'both') return '둘 다';
  if (v === 'ruleOnly') return '규칙만';
  if (v === 'llmOnly') return 'LLM 만';
  return '둘 다 틀림';
}

/** 임계값을 훑을 구간. 0.29 아래는 응답률이 이미 100% 이고, 0.65 위는 거의 다 침묵한다. */
const SWEEP_MIN = 0.05;
const SWEEP_MAX = 0.65;

/**
 * 신뢰도 임계값 스윕(#D3).
 *
 * 위 카드가 "임계값을 올리면 오답이 줄고 과잉 불응답이 는다"고 <b>주장</b>한다. 그 문장을 읽고
 * 믿는 것과, 슬라이더를 밀어 두 수치가 실제로 반대로 움직이는 것을 보는 것은 다르다.
 * 골드셋과 엔진이 모두 결정적이라 임계값만 바꿔 다시 돌리면 같은 답이 나오므로, 이 화면에서
 * 그 곡선을 직접 그려 볼 수 있다.
 *
 * <b>이것은 설정이 아니라 계측기다.</b> 여기서 민 값은 제품 경로에 영향을 주지 않는다 -
 * 질문 화면은 항상 기본 임계값으로 답한다(같은 질문의 답이 어느 화면에서 물었느냐에 따라
 * 갈리면 안 된다). 그래서 위쪽 표들도 슬라이더를 따라 움직이지 않는다: 그 표는 "배포된 품질"
 * 이고 이 패널은 "만약 다르게 잡았다면" 이다.
 *
 * 기본값이 0.29 인 근거도 여기서 읽힌다 - 응답률을 76% 로 유지하면서 "답 없음" 문항을 처음으로
 * 전부(8/8) 맞히는 지점이다. 더 낮추면 침묵을 놓치고, 더 올리면 답을 버린다.
 */
function ThresholdSweep() {
  const [threshold, setThreshold] = useState(CONFIDENCE_THRESHOLD);
  // 평가는 결정적이고 수 ms 라 임계값이 바뀔 때만 다시 돈다(드래그 중 매 프레임 재계산 방지).
  const report = useMemo(() => evaluate(undefined, threshold), [threshold]);

  const { answer, abstention } = report;
  const answerRate = answer.n ? answer.answered / answer.n : 0;
  const precision = answer.answered ? answer.correct / answer.answered : 0;
  const isDefault = Math.abs(threshold - CONFIDENCE_THRESHOLD) < 1e-9;

  return (
    <>
      <h2 className="evalH2">임계값을 옮기면 무엇이 바뀌나</h2>
      <div className="sweep">
        <div className="sweepRow">
          <label htmlFor="threshold" className="sweepLabel">
            신뢰도 임계값
          </label>
          <input
            id="threshold"
            className="sweepRange"
            type="range"
            min={SWEEP_MIN}
            max={SWEEP_MAX}
            step={0.01}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            /* 숫자만 읽히면 "0.29" 가 무엇인지 알 수 없다 - 그 값에서의 결과를 함께 읽힌다. */
            aria-valuetext={`${threshold.toFixed(2)}, 응답률 ${pct(answerRate)}, 응답 중 정답률 ${pct(precision)}`}
          />
          <output htmlFor="threshold" className="sweepValue">
            {threshold.toFixed(2)}
          </output>
          <button
            type="button"
            className="secondaryBtn"
            onClick={() => setThreshold(CONFIDENCE_THRESHOLD)}
            disabled={isDefault}
          >
            기본값
          </button>
        </div>

        <div className="evalCards" role="group" aria-label="임계값에 따른 지표">
          <div className="evalCard">
            <span className="ev">{pct(answerRate)}</span>
            <span className="ek">응답률</span>
            <span className="ed">답이 있는 {answer.n}문항 중 실제로 답한 비율.</span>
          </div>
          <div className="evalCard">
            <span className="ev">{pct(precision)}</span>
            <span className="ek">응답 중 정답률</span>
            <span className="ed">답한 것만 세어 맞은 비율. 임계값을 올리면 오른다.</span>
          </div>
          <div className="evalCard">
            <span className="ev">
              {abstention.abstained}/{abstention.n}
            </span>
            <span className="ek">올바른 침묵</span>
            <span className="ed">코퍼스에 답이 없는 문항을 제대로 거절한 수.</span>
          </div>
          <div className="evalCard">
            <span className="ev">{abstention.overAbstained}건</span>
            <span className="ek">과잉 불응답</span>
            <span className="ed">답이 있는데 침묵한 수. 임계값을 올리면 는다.</span>
          </div>
        </div>

        <p className="sweepNote" role="status">
          {isDefault ? (
            <>
              <b>기본값 {CONFIDENCE_THRESHOLD}</b> - 응답률을 {pct(answerRate)} 로 유지하면서
              &ldquo;답 없음&rdquo; 문항을 처음으로 전부 맞히는 지점입니다. 낮추면 침묵을 놓치고,
              올리면 답을 버립니다.
            </>
          ) : threshold < CONFIDENCE_THRESHOLD ? (
            <>
              기본값보다 <b>낮습니다</b> - 더 많이 답하지만 근거가 약한 답이 섞이고, 답이 없는
              문항을 거절하지 못합니다(올바른 침묵 {abstention.abstained}/{abstention.n}).
            </>
          ) : (
            <>
              기본값보다 <b>높습니다</b> - 답한 것의 정답률은 오르지만 답할 수 있었던{' '}
              {abstention.overAbstained}문항을 버렸습니다.
            </>
          )}
        </p>
      </div>
    </>
  );
}

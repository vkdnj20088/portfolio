'use client';

import { useState } from 'react';
import { VERDICT_LABEL, type EvalReport } from '@chat/agent-core';
import { AppShell } from '@/components/AppShell';
import { AgentTabs } from '@/components/AgentTabs';
import {
  caseProblems,
  cases,
  hasRuns,
  judgmentBundle,
  report,
  runBundle,
  scenarioSpread,
} from '@/lib/agent/eval/dataset';

/**
 * 회귀인가 잡음인가 - 이 화면이 30초 안에 말하려는 것.
 *
 *   "에이전트가 나아졌다는 말을, 잡음이 아니라고 증명할 수 있다. 증명할 수 없으면 없다고 말한다."
 *
 * 화면 순서가 곧 논증 순서다. 판정 문장 -> 자기 분산 -> 쌍대 검정과 검정력 -> 심판을 믿는
 * 근거 -> 케이스별 탐색. **자기 분산을 먼저 놓는 것이 이 화면의 핵심**이다. 구성 A 가 회차마다
 * 얼마나 흔들리는지 먼저 보면, B 의 평균이 몇 %p 높다는 사실이 그 자체로는 아무 말도 하지
 * 않는다는 것을 누구나 안다. 대부분의 평가 화면이 이 줄을 빼먹고 막대 두 개를 나란히 세운다.
 */
const REPORT = report();
const PROBLEMS = caseProblems();
const SPREAD = scenarioSpread();

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const pp = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%p`;

export default function AgentEvalPage() {
  return (
    <AppShell>
      <div className="page">
        <div className="pageHead">
          <h1>회귀인가 잡음인가</h1>
          <p>
            같은 과제를 <b>구성 두 종으로 세 번씩</b> 돌리고, 통과율 차이가 잡음과 구분되는지
            판정합니다. 실행 되짚기가 실행 <b>하나</b>를 보는 화면이라면 여기는 실행 <b>여럿</b>을
            봅니다. 단위가 다르니 필요한 것도 다릅니다 - 저쪽은 span 트리, 여기는 표본과 통계입니다.
          </p>
        </div>

        <AgentTabs />

        {PROBLEMS.errors.length > 0 ? <Problems problems={PROBLEMS.errors} /> : null}
        {!hasRuns() ? <NotCollected /> : <Body report={REPORT} />}
        {PROBLEMS.staleAnchors.length > 0 ? <StaleAnchors items={PROBLEMS.staleAnchors} /> : null}

        <Caveats />
      </div>
    </AppShell>
  );
}

/** 승격 자산이 깨졌으면 수치보다 먼저 말한다. 오타 난 케이스는 조용히 빠져 통과율을 올린다. */
function Problems({ problems }: { problems: string[] }) {
  return (
    <div className="agentEmpty tone-bad">
      <h2>케이스 정의에 문제가 있습니다</h2>
      <ul className="evalNote">
        {problems.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * 승격 링크가 끊긴 것. 채점에는 영향이 없다 - 채점은 시나리오 단위로 붙고 spanId 는
 * "사람이 어디를 보다가 승격했나"를 남기는 자리다. 오류와 같은 칸에 두면 진짜 오류가 묻힌다.
 */
function StaleAnchors({ items }: { items: string[] }) {
  return (
    <section className="evalBlock">
      <h2 className="evalH2">되짚기 링크가 끊긴 케이스</h2>
      <p className="evalNote">
        재수집을 하면 스텝 수가 달라지면서 안쪽 span 의 id 가 밀립니다. 채점은 시나리오 단위로
        붙으므로 수치에는 영향이 없고, 끊긴 것은 &ldquo;이 케이스가 어느 자리에서 나왔나&rdquo;로
        되돌아가는 링크뿐입니다. 고치려면 지금 기록에서 다시 승격하면 됩니다.
      </p>
      <ul className="evalNote">
        {items.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </section>
  );
}

function NotCollected() {
  return (
    <div className="agentEmpty">
      <h2>아직 수집 전입니다</h2>
      <p>
        이 배포에는 API 키가 없습니다. 분산을 재려면 같은 조건을 여러 번 돌린 표본이 있어야 하고,
        회귀인지 잡음인지 가르려면 조건이 둘이어야 합니다. 키를 가진 사람이 한 번 돌려 커밋한 기록을
        재생하는 방식인데, 그 산출물이 아직 비어 있습니다.
      </p>
      <p className="evalNote">
        케이스 정의({cases().length}건)는 이미 커밋되어 있습니다. 채점기와 통계도 그대로 있고, 비어
        있는 것은 실행 표본과 심판 판정뿐입니다.
      </p>
    </div>
  );
}

function Body({ report }: { report: EvalReport }) {
  return (
    <>
      <Verdict report={report} />
      <SelfSpreadSection report={report} />
      <TestSection report={report} />
      <JudgeSection report={report} />
      <PerCaseTable report={report} />
    </>
  );
}

// ---------------------------------------------------------------------------
// 1. 판정 문장
// ---------------------------------------------------------------------------

function Verdict({ report }: { report: EvalReport }) {
  const [a, b] = report.variants;
  const tone = report.verdict === 'signal' ? 'ok' : report.verdict === 'noise' ? 'warn' : 'muted';
  return (
    <section className={`evalVerdict tone-${tone}`}>
      <p className="vLine">{VERDICT_LABEL[report.verdict]}</p>
      {a && b ? (
        <p className="vDetail">
          {a.label} {pct(report.passRate[a.id]?.rate ?? 0)} → {b.label}{' '}
          {pct(report.passRate[b.id]?.rate ?? 0)} ({pp(report.ci.estimate)}), 쌍{' '}
          {report.pairs.length}건 중 판정이 갈린 쌍 {report.mcnemar.discordant}건.
        </p>
      ) : null}
      {report.unscored > 0 ? (
        <p className="evalNote">
          채점하지 못한 체크가 남은 칸이 {report.unscored}건 있습니다. 통과로 접지 않았습니다 -
          접으면 심판 수집 전이 만점으로 보입니다.
        </p>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 2. 자기 분산
// ---------------------------------------------------------------------------

function SelfSpreadSection({ report }: { report: EvalReport }) {
  return (
    <section className="evalBlock">
      <h2 className="evalH2">먼저, 각 구성이 자기 자신과 얼마나 흔들리는가</h2>
      <p className="evalNote">
        같은 구성을 같은 과제에 세 번 돌린 결과입니다. 이 폭보다 작은 차이는 두 구성을 비교해 봐야
        의미가 없습니다.
      </p>
      <div className="spreadRows">
        {report.spreads.map((s) => {
          const v = report.variants.find((x) => x.id === s.variantId);
          return (
            <div key={s.variantId} className="spreadRow">
              <span className="sName">{v?.label ?? s.variantId}</span>
              <span className="sBar" aria-hidden>
                <span
                  className="sFill"
                  style={{
                    left: `${s.low * 100}%`,
                    width: `${Math.max(1.5, (s.high - s.low) * 100)}%`,
                  }}
                />
              </span>
              <span className="sRange">
                {pct(s.low)} ~ {pct(s.high)}
              </span>
            </div>
          );
        })}
      </div>
      <p className="evalNote">
        {report.spreadsOverlap
          ? '두 구성의 흔들림 구간이 겹칩니다. 평균이 달라 보여도 회차를 하나만 바꾸면 순서가 뒤집힐 수 있다는 뜻입니다.'
          : '두 구성의 흔들림 구간이 겹치지 않습니다. 자기 분산만으로는 설명되지 않는 차이가 있다는 뜻입니다.'}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 3. 쌍대 검정과 검정력
// ---------------------------------------------------------------------------

function TestSection({ report }: { report: EvalReport }) {
  const [a, b] = report.variants;
  return (
    <section className="evalBlock">
      <h2 className="evalH2">같은 케이스를 둘 다 풀었으므로 쌍으로 본다</h2>
      <div className="tableScroll">
        <table className="evalTable">
          <caption className="srOnly">쌍대 검정 결과</caption>
          <tbody>
            <tr>
              <th scope="row">{a?.label ?? 'A'} 만 통과한 쌍</th>
              <td>{report.mcnemar.bOnlyFail}건</td>
            </tr>
            <tr>
              <th scope="row">{b?.label ?? 'B'} 만 통과한 쌍</th>
              <td>{report.mcnemar.aOnlyFail}건</td>
            </tr>
            <tr>
              <th scope="row">McNemar 정확검정 p</th>
              <td>{report.mcnemar.pValue.toFixed(4)}</td>
            </tr>
            <tr>
              <th scope="row">통과율 차이 95% 구간</th>
              <td>
                {pp(report.ci.estimate)} [{pp(report.ci.low)}, {pp(report.ci.high)}]
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="evalNote">
        일치한 쌍(둘 다 통과 또는 둘 다 실패)은 검정에 들어가지 않습니다 - 어느 쪽이 나은지에 대해
        정보가 없기 때문입니다. 카이제곱 근사 대신 정확검정을 쓴 것은 표본이 작아서입니다. 구간은
        케이스 단위로 재표집하며(같은 케이스의 반복은 독립이 아닙니다), 시드가 고정이라 화면을 다시
        열어도 같은 값입니다.
      </p>
      <div className="powerBox">
        <b>이 규모가 못 보는 것</b>
        <p>
          쌍 {report.power.totalPairs}건에서 유의에 도달하려면 판정이 갈린 쌍이 최소{' '}
          {report.power.minDiscordant}건 한쪽으로 몰려야 합니다. 통과율 차이로 환산하면 약{' '}
          {pct(report.power.minDetectableDiff)}
          {' 미만의 변화는 이 표본으로는 보이지 않습니다. '}
          유의하지 않다는 결과를 &ldquo;차이가 없다&rdquo;로 읽으면 안 되는 이유입니다.
        </p>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 4. 심판
// ---------------------------------------------------------------------------

function JudgeSection({ report }: { report: EvalReport }) {
  const jb = judgmentBundle();
  const byId = new Map(cases().map((c) => [c.id, c]));
  return (
    <section className="evalBlock">
      <h2 className="evalH2">심판을 누가 심판하는가</h2>
      <p className="evalNote">
        체크의 대부분은 규칙이 채점합니다(최종 상태, 도구 호출, 인용한 문단이 도구 출력 안인지).
        규칙으로 쓸 수 없는 자연어 판단만 심판에게 맡기고, 심판 셋은 모델 셋이 아니라{' '}
        <b>루브릭 프레이밍 셋</b>입니다 - 같은 모델에 같은 질문을 다르게 물어봅니다.
      </p>
      <div className="tableScroll">
        <table className="evalTable">
          <caption className="srOnly">심판 신뢰 지표</caption>
          <tbody>
            <tr>
              <th scope="row">판정이 갈리지 않은 비율</th>
              <td>{pct(report.agreement.simple)}</td>
            </tr>
            <tr>
              <th scope="row">Fleiss&rsquo; kappa</th>
              <td>
                {Number.isNaN(report.agreement.kappa)
                  ? '정의 불가'
                  : report.agreement.kappa.toFixed(3)}
              </td>
            </tr>
            <tr>
              <th scope="row">사람 라벨과의 일치</th>
              <td>
                {report.trust.anchorAccuracy === null
                  ? '앵커 없음'
                  : `${pct(report.trust.anchorAccuracy)} (${report.trust.anchorCount}건)`}
              </td>
            </tr>
            <tr>
              <th scope="row">함정 케이스 적발</th>
              <td>
                {report.trust.trapTotal === 0
                  ? '수집 전'
                  : `${report.trust.trapCaught}/${report.trust.trapTotal}`}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="evalNote">
        kappa 는 단독으로 읽지 않습니다. 판정이 한쪽으로 쏠린 데이터에서 값이 과도하게 낮아지는
        성질이 있어, 일치율이 높아도 0 근처로 나올 수 있습니다. 일치도만으로는 심판이{' '}
        <b>한결같이 틀리는</b> 경우를 못 잡기 때문에 사람 라벨과 함정을 함께 둡니다 - 앵커는 편향을,
        함정은 무능을 잡습니다.
      </p>
      {report.agreement.splits.length > 0 ? (
        <>
          <h3 className="evalH3">심판이 갈린 항목</h3>
          <p className="evalNote">
            갈렸다는 것은 <b>그 항목의 기준이 모호하다</b>는 뜻이지 에이전트가 나쁘다는 뜻이
            아닙니다. 이 목록이 루브릭을 고칠 다음 작업입니다.
          </p>
          <div className="tableScroll">
            <table className="evalTable splitTable">
              <caption className="srOnly">심판이 갈린 항목</caption>
              <thead>
                <tr>
                  <th scope="col">케이스</th>
                  <th scope="col">체크</th>
                  <th scope="col">구성/회차</th>
                  <th scope="col">심판별 판정</th>
                </tr>
              </thead>
              <tbody>
                {report.agreement.splits.map((s) => {
                  const votes = jb.judgments.filter(
                    (j) =>
                      j.caseId === s.caseId &&
                      j.checkId === s.checkId &&
                      j.variantId === s.variantId &&
                      j.runIndex === s.runIndex,
                  );
                  return (
                    <tr key={`${s.caseId}|${s.checkId}|${s.variantId}|${s.runIndex}`}>
                      <td>{byId.get(s.caseId)?.title ?? s.caseId}</td>
                      <td>{s.checkId}</td>
                      <td>
                        {s.variantId}/{s.runIndex}
                      </td>
                      <td>
                        {votes.map((v) => (
                          <div key={v.rubricId} className="voteLine">
                            <b>{v.rubricId}</b> {v.verdict} — {v.reason}
                          </div>
                        ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 5. 케이스별 탐색 표
// ---------------------------------------------------------------------------

function PerCaseTable({ report }: { report: EvalReport }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="evalBlock">
      <h2 className="evalH2">케이스별로 보면</h2>
      <p className="evalNote">
        <b>이건 검정이 아니라 눈으로 보는 표입니다.</b> 케이스마다 따로 검정을 걸면 12번 중 하나쯤은
        우연히 유의하게 나옵니다. 검정은 전체 통과율 하나에만 걸었습니다.
      </p>
      <div className="tableScroll">
        <table className="evalTable">
          <caption className="srOnly">케이스별 통과 횟수</caption>
          <thead>
            <tr>
              <th scope="col">케이스</th>
              <th scope="col">시나리오</th>
              {report.variants.map((v) => (
                <th key={v.id} scope="col">
                  {v.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.perCase.map((row) => (
              <tr key={row.caseId}>
                <td>{row.title}</td>
                <td>{row.scenarioId}</td>
                {report.variants.map((v) => {
                  const cell = row.byVariant[v.id];
                  return <td key={v.id}>{cell ? `${cell.passed}/${cell.total}` : '-'}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" className="linkBtn" onClick={() => setOpen((x) => !x)}>
        {open ? '구성 정의 접기' : '두 구성이 정확히 무엇이 다른지 보기'}
      </button>
      {open ? <VariantDetail report={report} /> : null}
    </section>
  );
}

function VariantDetail({ report }: { report: EvalReport }) {
  const rb = runBundle();
  return (
    <div className="tableScroll">
      <table className="evalTable splitTable">
        <caption className="srOnly">구성 정의</caption>
        <thead>
          <tr>
            <th scope="col">구성</th>
            <th scope="col">무엇이 다른가</th>
            <th scope="col">프롬프트 해시</th>
            <th scope="col">도구집합 해시</th>
          </tr>
        </thead>
        <tbody>
          {report.variants.map((v) => (
            <tr key={v.id}>
              <td>{v.label}</td>
              <td>{v.note}</td>
              <td>
                <code>{v.systemPromptDigest}</code>
              </td>
              <td>
                <code>{v.toolsetDigest}</code>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4} className="evalNote">
              {rb.model} · 회차 {rb.repeat}회 · {rb.generatedAt.slice(0, 10)} 수집. 도구집합 해시가
              두 구성에서 같으므로 달라진 것은 지시 문장 하나뿐입니다.
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 이 화면이 못 보는 것
// ---------------------------------------------------------------------------

function Caveats() {
  return (
    <section className="evalBlock">
      <h2 className="evalH2">이 화면의 한계</h2>
      <ul className="evalNote">
        <li>
          <b>1단계와 다른 점.</b> 실행 되짚기 화면은 도구를 <b>지금 다시 실행</b>해 커밋본과
          대조합니다. 이 화면의 통계는 <b>수집 시점의 그 회차들</b>에 대한 것이고 지금 다시 돌릴 수
          없습니다 - 배포에 키가 없기 때문입니다. 감출 수 있는 비대칭이지만 감추지 않습니다.
        </li>
        <li>
          <b>케이스는 서로 독립이 아닙니다.</b> 케이스 {SPREAD.cases}건은 시나리오{' '}
          {SPREAD.scenarios}개에서 나왔습니다. 같은 시나리오에서 나온 케이스들은 함께 성공하고 함께
          실패하는 경향이 있어, 부트스트랩 구간이 실제보다 좁게 나옵니다.
        </li>
        <li>
          <b>자동 승격은 하지 않습니다.</b> 실패한 실행을 자동으로 기대값으로 굳히면 지금 동작이
          정답이 되고, 그 뒤로는 회귀를 정답이라고 부르게 됩니다. 승격은 사람이 span 을 보고
          판단합니다.
        </li>
        <li>
          <b>DocuQA 품질 지표와는 다른 문제를 풉니다.</b> 저쪽이 재는 규칙 엔진은 같은 입력에 분산이
          0이라 골드셋과 임계값이면 충분하고, 값이 바뀌면 그대로 회귀입니다. 여기는 값이 바뀌어도
          회귀가 아닐 수 있어 반복과 통계가 필요합니다.
        </li>
      </ul>
    </section>
  );
}

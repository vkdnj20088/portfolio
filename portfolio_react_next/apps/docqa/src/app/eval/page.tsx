'use client';

import { CONFIDENCE_THRESHOLD, evaluate } from '@chat/search-domain';
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
            직접 라벨링한 <b>골드셋 {report.cases}문항</b>(문서 어휘 그대로 / 동의어로만 / 코퍼스에 답
            없음)으로 검색·독해·불응답을 측정합니다. 엔진이 결정적이라 같은 코드는 늘 같은 표를 냅니다 -
            그래서 이 수치는 테스트에서 <b>회귀 게이트</b>로도 씁니다.
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
              답이 없어야 하는 {report.abstention.n}문항 중 실제로 침묵한 비율. 이 데모가 파는 지표라
              100% 아래로 내려가면 테스트가 깨집니다.
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

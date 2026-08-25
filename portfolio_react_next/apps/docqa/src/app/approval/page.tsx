'use client';

import { useMemo, useState } from 'react';
import {
  APPROVER_MODE_LABEL,
  GUARD_LABEL,
  GUARD_WHEN_OFF,
  MAX_APPROVE_ATTEMPTS,
  MAX_RECONCILE_FAILURES,
  PRESETS,
  RECLAIM_TARGET_LABEL,
  STATUS_LABEL,
  UNKNOWN_FALLBACK_LABEL,
  presetById,
  runLab,
  type ApproverMode,
  type GuardConfig,
  type LabExpectation,
  type LabRun,
  type LabStep,
  type PresetId,
  type ReclaimTarget,
  type UnknownFallback,
} from '@chat/approval-domain';
import { AppShell } from '@/components/AppShell';
import { committedPairs, driftedRuns } from '@/lib/approval/runs';
import {
  fromPreset,
  isContrastable,
  offGuardNames,
  patchOff,
  patchScenario,
  type LabState,
} from '@/lib/approval/labState';

/**
 * 이중 승인 실험대 - 이 화면이 30초 안에 말하려는 것.
 *
 *   "외부가 timeout 일 때 그것은 실패가 아니라 모름이고, 2 값으로 접으면 어느 쪽으로 접어도 틀린다."
 *
 * 켠 화면만 보여 주면 "원래 안 일어날 일 아니냐"는 의심이 남는다. 그래서 같은 시나리오를
 * 방어선만 끄고 켜서 나란히 돌리고, PG 쪽 승인 건수를 큰 숫자로 마주 놓는다.
 * 여섯 프리셋 중 P2 와 P6 은 방어선의 유무가 아니라 **그럴듯한 오답**을 실행해 보인다.
 *
 * 전부 브라우저 안에서 도는 순수 함수다. 서버도 외부 호출도 없다.
 */
const GUARD_KEYS: (keyof GuardConfig)[] = [
  'idempotencyKey',
  'claimTransition',
  'reconcileQuery',
  'attemptLimit',
];

const APPROVER_MODES: ApproverMode[] = [
  'normal',
  'timeout_after_approve',
  'timeout_before_approve',
  'down',
];

export default function ApprovalPage() {
  const [state, setState] = useState<LabState>(() => fromPreset('P1'));
  const off = useMemo(() => runLab(state.off), [state.off]);
  const on = useMemo(() => runLab(state.on), [state.on]);
  const preset = state.presetId ? presetById(state.presetId) : null;

  return (
    <AppShell>
      <div className="page approvalPage">
        <div className="pageHead">
          <h1>이중 승인 실험대</h1>
          <p>
            <b>timeout 은 실패가 아니다.</b> 결제 승인 요청의 응답이 오지 않았을 때 그것은 성공도
            실패도 아닌 <b>모름</b>입니다. 실패로 보고 다시 보내면 같은 결제가 두 번 청구되고,
            실패로 보고 포기하면 승인될 수 있었던 결제를 잃습니다. 같은 시나리오를 방어선만 끄고
            켜서 나란히 돌립니다.
          </p>
          <p className="apBadge">외부 호출 없음 · 내부 시뮬레이션 · 브라우저에서 전부 계산</p>
        </div>

        <Presets active={state.presetId} onPick={(id) => setState(fromPreset(id))} />
        {preset ? (
          <p className="apProves">
            <b>{preset.id}</b> {preset.situation} <span className="apArrow">→</span> {preset.proves}
          </p>
        ) : (
          <p className="apProves apCustom">
            직접 만든 설정입니다. 미리 적어 둔 기대값이 없으므로 아래 숫자는 <b>측정값만</b>{' '}
            보여줍니다.
          </p>
        )}

        <div className="apLayout">
          <ControlPanel state={state} setState={setState} />
          <Timelines state={state} off={off} on={on} />
          <CounterPanel
            off={off}
            on={on}
            expectOff={preset?.off.expect ?? null}
            expectOn={preset?.on.expect ?? null}
            verdictOff={preset?.off.verdict ?? null}
            verdictOn={preset?.on.verdict ?? null}
          />
        </div>

        <Committed />
        <Honesty />
      </div>
    </AppShell>
  );
}

function Presets({ active, onPick }: { active: PresetId | null; onPick: (id: PresetId) => void }) {
  return (
    <div className="apPresets" role="group" aria-label="프리셋">
      {PRESETS.map((p) => (
        <button
          key={p.id}
          type="button"
          className={`apPreset${active === p.id ? ' isOn' : ''}`}
          onClick={() => onPick(p.id)}
          aria-pressed={active === p.id}
        >
          <span className="pId">{p.id}</span>
          <span className="pTitle">{p.title}</span>
        </button>
      ))}
    </div>
  );
}

function ControlPanel({
  state,
  setState,
}: {
  state: LabState;
  setState: (next: LabState) => void;
}) {
  const { off } = state;
  const reconcileOff = !off.guards.reconcileQuery;
  return (
    <aside className="apPanel" aria-label="제어판">
      <h2 className="apH2">제어판</h2>

      <div className="apField">
        <label htmlFor="ap-mode">PG 모드</label>
        <select
          id="ap-mode"
          value={off.approverMode}
          onChange={(e) =>
            setState(patchScenario(state, { approverMode: e.target.value as ApproverMode }))
          }
        >
          {APPROVER_MODES.map((m) => (
            <option key={m} value={m}>
              {APPROVER_MODE_LABEL[m]}
            </option>
          ))}
        </select>
        <p className="apHint">양쪽 실행에 같이 적용됩니다. 여기가 갈리면 대조가 아닙니다.</p>
      </div>

      <fieldset className="apField">
        <legend>끈 쪽에서 뺄 방어선 (체크한 것을 뺍니다)</legend>
        {GUARD_KEYS.map((key) => (
          <label key={key} className="apCheck">
            <input
              type="checkbox"
              checked={!off.guards[key]}
              onChange={(e) => setState(patchOff(state, { guards: { [key]: !e.target.checked } }))}
            />
            <span>
              {GUARD_LABEL[key]}
              <em>{GUARD_WHEN_OFF[key]}</em>
            </span>
          </label>
        ))}
        <p className="apHint">
          켠 쪽은 무엇을 만지든 전부 켜진 채로 남습니다 - 그쪽이 기준선입니다.
        </p>
      </fieldset>

      <div className="apField">
        <label htmlFor="ap-fold">대사를 껐을 때 접는 방향</label>
        <select
          id="ap-fold"
          value={off.unknownFallback}
          disabled={!reconcileOff}
          onChange={(e) =>
            setState(patchOff(state, { unknownFallback: e.target.value as UnknownFallback }))
          }
        >
          {(['retry', 'abandon'] as UnknownFallback[]).map((v) => (
            <option key={v} value={v}>
              {UNKNOWN_FALLBACK_LABEL[v]}
            </option>
          ))}
        </select>
        <p className="apHint">
          {reconcileOff
            ? '어느 쪽으로 접어도 틀립니다. 틀리는 방향이 다를 뿐입니다.'
            : '승인 조회 대사를 꺼야 쓰입니다.'}
        </p>
      </div>

      <div className="apField">
        <label htmlFor="ap-reclaim">회수 목적지 (끈 쪽)</label>
        <select
          id="ap-reclaim"
          value={off.reclaimTo}
          onChange={(e) =>
            setState(patchOff(state, { reclaimTo: e.target.value as ReclaimTarget }))
          }
        >
          {(['unknown', 'received'] as ReclaimTarget[]).map((v) => (
            <option key={v} value={v}>
              {RECLAIM_TARGET_LABEL[v]}
            </option>
          ))}
        </select>
      </div>

      <div className="apField apRow">
        <span className="apRowLabel">워커 수</span>
        <div className="apSegs" role="group" aria-label="워커 수">
          {([1, 2] as const).map((n) => (
            <button
              key={n}
              type="button"
              className={off.workers === n ? 'isOn' : ''}
              aria-pressed={off.workers === n}
              onClick={() => setState(patchScenario(state, { workers: n }))}
            >
              {n}대
            </button>
          ))}
        </div>
      </div>

      <fieldset className="apField">
        <legend>주입할 상황</legend>
        <label className="apCheck">
          <input
            type="checkbox"
            checked={off.doubleSubmit}
            onChange={(e) => setState(patchScenario(state, { doubleSubmit: e.target.checked }))}
          />
          <span>
            더블클릭<em>같은 멱등키로 접수가 두 번 들어온다</em>
          </span>
        </label>
        <label className="apCheck">
          <input
            type="checkbox"
            checked={off.redeliver}
            onChange={(e) => setState(patchScenario(state, { redeliver: e.target.checked }))}
          />
          <span>
            중복 전달<em>아웃박스가 같은 배치를 한 번 더 준다</em>
          </span>
        </label>
        <label className="apCheck">
          <input
            type="checkbox"
            checked={off.deadWorkerClaim}
            onChange={(e) => setState(patchScenario(state, { deadWorkerClaim: e.target.checked }))}
          />
          <span>
            워커 사망<em>승인 요청을 보낸 직후 상태를 남기기 전에 죽는다</em>
          </span>
        </label>
      </fieldset>

      <div className="apField apRow">
        <label htmlFor="ap-stale">회수 임계</label>
        <input
          id="ap-stale"
          type="number"
          min={0}
          step={1000}
          value={off.staleClaimMs}
          onChange={(e) =>
            setState(patchScenario(state, { staleClaimMs: Math.max(0, Number(e.target.value)) }))
          }
        />
        <span className="apUnit">ms</span>
      </div>
      <p className="apHint">
        운영 기본값은 30000ms 입니다. 워커 사망 프리셋만 0 으로 눌러 두는데, 30초를 기다릴 수
        없어서지 0 이 옳은 값이라서가 아닙니다. 너무 짧게 잡으면 살아서 응답을 기다리는 중인 결제를
        회수합니다.
      </p>

      <div className="apField apRow">
        <label htmlFor="ap-ticks">주기 수</label>
        <input
          id="ap-ticks"
          type="number"
          min={1}
          max={12}
          value={off.ticks}
          onChange={(e) =>
            setState(
              patchScenario(state, { ticks: Math.min(12, Math.max(1, Number(e.target.value))) }),
            )
          }
        />
      </div>

      <div className="apField">
        <label htmlFor="ap-recover">PG 회복 시점</label>
        <select
          id="ap-recover"
          value={off.approverRecoversAtTick ?? 0}
          onChange={(e) =>
            setState(
              patchScenario(state, {
                approverRecoversAtTick: Number(e.target.value) || null,
              }),
            )
          }
        >
          <option value={0}>회복하지 않음</option>
          {[2, 3, 4].map((n) => (
            <option key={n} value={n}>
              {n}번째 주기부터 정상
            </option>
          ))}
        </select>
      </div>

      <p className="apHint apLimits">
        상한은 두 종류입니다 — 전송 시도 {MAX_APPROVE_ATTEMPTS}회 · 조회 실패{' '}
        {MAX_RECONCILE_FAILURES}회. 하나로 합치면 &ldquo;보내다 실패했다&rdquo;와 &ldquo;보낸 결과를
        모른다&rdquo;가 같은 칸에 들어가 격리 사유가 뭉개집니다.
      </p>
    </aside>
  );
}

function Timelines({ state, off, on }: { state: LabState; off: LabRun; on: LabRun }) {
  const offNames = offGuardNames(state).map((k) => GUARD_LABEL[k]);
  const contrastable = isContrastable(state);
  return (
    <section className="apTimelines" aria-label="타임라인">
      <h2 className="apH2">타임라인</h2>
      {!contrastable ? (
        <p className="apWarn">
          지금은 양쪽 설정이 같습니다. 방어선을 하나 빼거나 회수 목적지를 바꿔야 대조가 됩니다.
        </p>
      ) : null}
      <div className="apLanes">
        <Lane
          title="방어선을 뺀 실행"
          subtitle={
            offNames.length > 0
              ? `뺀 것: ${offNames.join(' · ')}`
              : `회수 목적지: ${RECLAIM_TARGET_LABEL[state.off.reclaimTo]}`
          }
          run={off}
        />
        <Lane title="전부 켠 실행" subtitle="기준선" run={on} />
      </div>
    </section>
  );
}

function Lane({ title, subtitle, run }: { title: string; subtitle: string; run: LabRun }) {
  const ticks = groupByTick(run.timeline);
  return (
    <div className="apLane">
      <header>
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </header>
      {ticks.length === 0 ? <p className="apHint">남은 이벤트가 없습니다.</p> : null}
      {ticks.map(({ tick, steps }) => (
        <div key={tick} className="apTick">
          <span className="apTickNo">{tick === 0 ? '준비' : `주기 ${tick}`}</span>
          <ol>
            {steps.map((step) => (
              <li key={step.seq} className={`apStep tone-${step.tone}`}>
                <span className="sLabel">{step.label}</span>
                {step.why ? <span className="sWhy">{step.why}</span> : null}
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}

function groupByTick(steps: LabStep[]): { tick: number; steps: LabStep[] }[] {
  const groups: { tick: number; steps: LabStep[] }[] = [];
  for (const step of steps) {
    const last = groups.at(-1);
    if (last && last.tick === step.tick) last.steps.push(step);
    else groups.push({ tick: step.tick, steps: [step] });
  }
  return groups;
}

function CounterPanel({
  off,
  on,
  expectOff,
  expectOn,
  verdictOff,
  verdictOn,
}: {
  off: LabRun;
  on: LabRun;
  expectOff: LabExpectation | null;
  expectOn: LabExpectation | null;
  verdictOff: string | null;
  verdictOn: string | null;
}) {
  const duplicated = off.counters.approvedAtPg > on.counters.approvedAtPg;
  const lost = off.counters.approvedAtPg < on.counters.approvedAtPg;
  return (
    <aside className="apCounters" aria-label="카운터">
      <h2 className="apH2">숫자</h2>

      <div className={`apBigPair${duplicated || lost ? ' isSplit' : ''}`}>
        <BigNumber
          caption="뺀 쪽"
          value={off.counters.approvedAtPg}
          expected={expectOff?.approvedAtPg ?? null}
          bad={duplicated || lost}
        />
        <BigNumber
          caption="켠 쪽"
          value={on.counters.approvedAtPg}
          expected={expectOn?.approvedAtPg ?? null}
          bad={false}
        />
      </div>
      <p className="apBigCaption">PG 쪽에 남은 승인 건수</p>
      {duplicated ? (
        <p className="apVerdict isBad">
          같은 결제가 {off.counters.approvedAtPg}번 승인됐습니다. 되돌리려면 망취소가 필요합니다.
        </p>
      ) : null}
      {lost ? (
        <p className="apVerdict isBad">
          승인될 수 있었던 결제를 잃었습니다. 이중 청구는 없지만 그것이 옳다는 뜻은 아닙니다.
        </p>
      ) : null}

      <div className="apCounterRow apCounterHead" aria-hidden="true">
        <span className="cLabel">측정 / 기대</span>
        <span className="cValue">뺀 쪽</span>
        <span className="cValue">켠 쪽</span>
      </div>
      <CounterRow
        label="우리 호출 횟수"
        off={off.counters.approveCalls}
        on={on.counters.approveCalls}
        expectOff={expectOff?.approveCalls ?? null}
        expectOn={expectOn?.approveCalls ?? null}
      />
      <CounterRow
        label="승인 조회 횟수"
        off={off.counters.queryCalls}
        on={on.counters.queryCalls}
        expectOff={null}
        expectOn={null}
      />
      <CounterRow
        label="결제 요청 건수"
        off={off.counters.requests}
        on={on.counters.requests}
        expectOff={expectOff?.requests ?? null}
        expectOn={expectOn?.requests ?? null}
      />

      <dl className="apStatuses">
        <dt>뺀 쪽 최종 상태</dt>
        <dd>{off.requests.map((r) => STATUS_LABEL[r.status]).join(', ')}</dd>
        <dt>켠 쪽 최종 상태</dt>
        <dd>{on.requests.map((r) => STATUS_LABEL[r.status]).join(', ')}</dd>
      </dl>

      {verdictOff ? (
        <p className="apNote">
          <b>뺀 쪽</b> {verdictOff}
        </p>
      ) : null}
      {verdictOn ? (
        <p className="apNote">
          <b>켠 쪽</b> {verdictOn}
        </p>
      ) : null}

      {off.settleConflicts + on.settleConflicts > 0 ? (
        <p className="apVerdict isBad">
          클레임 이후 전이 실패 {off.settleConflicts + on.settleConflicts}건. 정상 경합이 아니라
          조사 대상입니다 - 승인 요청은 나갔는데 상태를 남기지 못한 경우가 여기 걸립니다.
        </p>
      ) : null}
    </aside>
  );
}

function BigNumber({
  caption,
  value,
  expected,
  bad,
}: {
  caption: string;
  value: number;
  expected: number | null;
  bad: boolean;
}) {
  return (
    <div className={`apBig${bad ? ' isBad' : ''}`}>
      <span className="bCaption">{caption}</span>
      <strong>{value}</strong>
      {expected === null ? (
        <span className="bExpect">기대값 없음</span>
      ) : (
        <span className={`bExpect${expected === value ? ' isOk' : ' isMiss'}`}>
          기대 {expected}
        </span>
      )}
    </div>
  );
}

function CounterRow({
  label,
  off,
  on,
  expectOff,
  expectOn,
}: {
  label: string;
  off: number;
  on: number;
  expectOff: number | null;
  expectOn: number | null;
}) {
  return (
    <div className="apCounterRow">
      <span className="cLabel">{label}</span>
      <span className="cValue">
        {off}
        {expectOff === null ? null : <em>/{expectOff}</em>}
      </span>
      <span className="cValue">
        {on}
        {expectOn === null ? null : <em>/{expectOn}</em>}
      </span>
    </div>
  );
}

/**
 * 커밋된 열두 실행.
 *
 * 다른 데모의 커밋 산출물은 "키가 없어 재생한다"는 장치지만 여기는 다르다 - 이 엔진은
 * 지금 이 자리에서 다시 돈다. 그래서 이 표의 값은 재생이 아니라 **표류 감지기**다.
 * 위 실험대가 계산한 값과 갈리면 엔진이 바뀐 것이고, 같은 대조를 테스트도 한다.
 */
function Committed() {
  const drift = driftedRuns();
  const pairs = committedPairs();
  return (
    <section className="evalBlock">
      <h2 className="evalH2">커밋된 열두 실행</h2>
      <p className={`apDrift${drift.length === 0 ? ' isOk' : ' isBad'}`}>
        {drift.length === 0
          ? '커밋된 숫자와 지금 계산한 숫자가 전부 같습니다. 열두 실행 모두 표류 없음.'
          : `커밋된 숫자와 지금 계산한 숫자가 ${drift.length}곳에서 갈립니다 - 엔진이 바뀌었습니다.`}
      </p>
      <div className="tableScroll">
        <table className="evalTable splitTable">
          <caption className="srOnly">프리셋별 방어선 끔/켬 결과</caption>
          <thead>
            <tr>
              <th scope="col">프리셋</th>
              <th scope="col">PG 승인</th>
              <th scope="col">우리 호출</th>
              <th scope="col">결제 요청</th>
              <th scope="col">최종 상태</th>
            </tr>
          </thead>
          <tbody>
            {pairs.map((pair) => (
              <tr key={pair.presetId}>
                <th scope="row">
                  {pair.presetId} {pair.title}
                </th>
                <td>
                  <Pair
                    off={pair.off?.approvedAtPg}
                    on={pair.on?.approvedAtPg}
                    bad={(pair.off?.approvedAtPg ?? 0) !== (pair.on?.approvedAtPg ?? 0)}
                  />
                </td>
                <td>
                  <Pair
                    off={pair.off?.approveCalls}
                    on={pair.on?.approveCalls}
                    bad={(pair.off?.approveCalls ?? 0) > (pair.on?.approveCalls ?? 0)}
                  />
                </td>
                <td>
                  <Pair
                    off={pair.off?.requests}
                    on={pair.on?.requests}
                    bad={(pair.off?.requests ?? 0) !== (pair.on?.requests ?? 0)}
                  />
                </td>
                <td>
                  <Pair
                    off={pair.off ? STATUS_LABEL[pair.off.finalStatus] : undefined}
                    on={pair.on ? STATUS_LABEL[pair.on.finalStatus] : undefined}
                    bad={pair.off?.finalStatus !== pair.on?.finalStatus}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="evalNote">
        왼쪽이 방어선을 뺀 쪽, 오른쪽이 전부 켠 쪽입니다. 산출물에 수집 시각을 넣지 않았습니다 -
        실행이 결정적이라 시각만 바뀌면 내용이 같은 diff 가 매번 생기고, 그러면 이 파일이 표류를
        알리는 신호가 아니라 잡음이 됩니다. 언제 수집했는지는 커밋이 압니다.
      </p>
    </section>
  );
}

function Pair({ off, on, bad }: { off?: number | string; on?: number | string; bad: boolean }) {
  return (
    <span className="apPair">
      <b className={bad ? 'isBad' : ''}>{off ?? '-'}</b>
      <span aria-hidden="true">&#8594;</span>
      <b>{on ?? '-'}</b>
    </span>
  );
}

function Honesty() {
  return (
    <section className="evalBlock">
      <h2 className="evalH2">이 데모가 증명하지 않는 것</h2>
      <ul className="evalNote">
        <li>
          <b>진짜 병렬이 아닙니다.</b> 워커 두 대는 같은 프로세스 안에서 차례로 돕니다. 인터리빙의
          한 경우를 본 것이지 동시 실행을 본 것이 아닙니다.
        </li>
        <li>
          <b>실제 DB 락 경합은 다루지 않았습니다.</b> 조건부 전이의 운영 대응은{' '}
          <code>UPDATE ... WHERE status = ?</code> 이고 그 행의 잠금 경합·데드락·격리 수준 문제는 이
          모형으로 알 수 없습니다.
        </li>
        <li>
          <b>크래시를 실제로 주입하지 않았습니다.</b> 프로세스를 죽이는 대신 클레임만 남기고 멈춘
          상태를 저장소에 직접 만들었습니다. 커밋 도중에 죽는 경우는 이 모형이 다루지 못합니다.
        </li>
        <li>
          <b>성능은 측정하지 않았습니다.</b> 지연·처리량·부하 어느 것도 재지 않았습니다.
        </li>
        <li>
          <b>회수 임계 시간은 실측이 아닙니다.</b> 워커 사망 프리셋에서 0ms 로 눌러 두는 것은 30초를
          기다릴 수 없어서입니다. 실제 값은 응답 시간 분포를 재서 정해야 하고, 짧게 잡으면 살아 있는
          결제를 회수합니다.
        </li>
        <li>
          <b>조회가 느린 경우는 다루지 않았습니다.</b> 조회 실패(연결 불가)만 시험했습니다. 조회
          자체가 timeout 나는 경우에도 상태는 모름으로 유지돼야 하는데, 그 경로는 만들지 않았습니다.
        </li>
        <li>
          <b>가장 큰 가정 — 승인 조회 API 가 있다는 것입니다.</b> 이 가정이 깨지면 여기 있는 해법이
          통째로 성립하지 않습니다. 없다면 순서대로 후퇴합니다: ① 멱등키 계약을 PG 와 협상 ② 일 단위
          대사 배치와 수동 확인 ③ 그것도 안 되면 자동 재시도를 하지 않고 전량 사람 확인. 실무라면 이
          계약 확인이 1순위입니다.
        </li>
        <li>
          <b>망취소는 구현하지 않았습니다.</b>
          {' 조회가 '}
          &ldquo;승인됨&rdquo;이라고 답했을 때 이 데모는 확정만 합니다. 그 결제를 되돌려야 하는
          경우가 망취소인데, 이번 범위 밖입니다.
        </li>
      </ul>
      <p className="evalNote">
        같은 설정은 항상 같은 타임라인을 냅니다. 난수를 쓰지 않고 시간과 ID 를 주입하기 때문이고,
        그래서 이 화면에는 시드 입력이 없습니다 - 재현의 단위는 시드가 아니라 위 설정 자체입니다.
      </p>
    </section>
  );
}

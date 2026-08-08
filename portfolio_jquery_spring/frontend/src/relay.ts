/*
 * 작업 릴레이 - 재시도 파이프라인 프론트엔드 (TypeScript + jQuery, webpack 별도 엔트리)
 *
 * 설계 메모:
 *  - 화면의 주인공은 큐 통계가 아니라 **한 작업의 시도 이력**이다. 실패가 일어나고, 재개되고,
 *    포기 지점이 있다는 세 증거가 타임라인 한 칸씩에 대응한다.
 *  - 서버는 상태·오류·유형을 enum 코드로만 준다. 문장은 lib/relayMessages.ts 카탈로그가
 *    조립한다(현지화 사전 조치 - 문자열을 화면에 흩뿌리지 않는다).
 *  - 갱신은 짧은 폴링(1.5s)이다. SSE 는 챗·문서QA 데모가 이미 증명했고, 여기서 반복하면
 *    보여 주는 것 없이 표면만 는다(README). 탭이 숨겨지면 폴링을 쉰다.
 *  - 시각은 ISO(UTC)로 받아 접속 기기 시간대로 렌더한다(IP 화면과 같은 원칙).
 *  - 사용자 제어 값(키/페이로드)은 textContent 로 렌더한다(DOM XSS 방지).
 */
import './styles/relay.scss';
import $ from 'jquery';
import { portfolioHomeHref, screenHref, type Screen } from './config';
import { Problem, RelayEnqueueResponse, RelayJob, RelayJobList, RelayStats } from './types';
import {
  ERROR_LABEL, SCENARIO_LABEL, STATUS_LABEL, TYPE_LABEL,
  backoffFormula, fmtClock, fmtSec, fmtUntil,
} from './lib/relayMessages';

const API = { jobs: '/api/relay/jobs' } as const;
const POLL_MS = 1_500;

// 큐 현황 칸의 고정 순서 - 파이프라인의 흐름 순서다(대기 -> 실행 -> 재시도 -> 종결).
const STAT_ORDER = ['PENDING', 'RUNNING', 'RETRYING', 'SUCCEEDED', 'DEAD_LETTER', 'CANCELED'];

let keySeq = 0;
let polling: number | undefined;
// 멱등 데모 카운터 - 화면 조작 기준의 상태라 클라이언트가 센다.
const idem = { req: 0, created: 0, dup: 0 };

// ---- 유틸 ---------------------------------------------------------------
let toastTimer: number | undefined;
function toast(message: string, kind?: 'ok' | 'error'): void {
  const $t = $('#toast').text(message)
    .removeClass('toast--error toast--ok')
    .addClass('toast--show');
  if (kind) $t.addClass('toast--' + kind);
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { $t.removeClass('toast--show'); }, 2200);
}

function problemOf(xhr: JQuery.jqXHR): Problem | null {
  try {
    return (xhr.responseJSON ?? JSON.parse(xhr.responseText)) as Problem;
  } catch {
    return null;
  }
}

/** 유일하면 되는 값이라 시각+순번으로 만든다(동작의 결정성과 무관한 식별자). */
function freshKey(): string {
  return `job-${Date.now().toString(36)}${(keySeq++).toString(36)}`;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, className?: string, text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// ---- 렌더 ---------------------------------------------------------------
function renderStats(stats: RelayStats): void {
  const grid = $('#statGrid')[0] as HTMLElement;
  grid.replaceChildren();
  STAT_ORDER.forEach((status) => {
    const cell = el('div', 'relay-stat relay-stat--' + status.toLowerCase());
    cell.appendChild(el('b', 'relay-stat__num', String(stats.byStatus[status] ?? 0)));
    cell.appendChild(el('span', 'relay-stat__label', STATUS_LABEL[status] ?? status));
    grid.appendChild(cell);
  });
  $('#outboxPending').text(String(stats.outboxPending));
  $('#ghostCount').text(String(stats.ghostEvents));
  $('.relay-ghost').toggleClass('relay-ghost--hot', stats.ghostEvents > 0);
}

function attemptRow(a: RelayJob['attempts'][number]): HTMLElement {
  const row = el('div', 'relay-attempt' + (a.success ? ' relay-attempt--ok' : ' relay-attempt--fail'));
  row.appendChild(el('span', 'relay-attempt__no', `#${a.attemptNo}`));
  row.appendChild(el('span', 'relay-attempt__clock', fmtClock(a.startedAt)));
  row.appendChild(el('span', 'relay-attempt__outcome', a.success ? '성공' : '실패'));
  row.appendChild(el('span', 'relay-attempt__error',
    a.errorCode ? (ERROR_LABEL[a.errorCode] ?? a.errorCode) : '-'));
  const backoff = el('span', 'relay-attempt__backoff');
  if (!a.success && a.backoffMs > 0) {
    backoff.textContent = `다음 +${fmtSec(a.backoffMs)}`;
    backoff.title = backoffFormula(a.attemptNo, a.backoffMs);
    backoff.appendChild(el('i', 'relay-attempt__formula', ` (${backoffFormula(a.attemptNo, a.backoffMs)})`));
  } else {
    backoff.textContent = a.success ? '종료' : '';
  }
  row.appendChild(backoff);
  if (a.cid) {
    const cid = el('code', 'relay-attempt__cid', a.cid);
    cid.title = '이 시도를 실행한 워커의 상관 ID - 서버 로그와 같은 식별자';
    row.appendChild(cid);
  }
  return row;
}

function jobCard(job: RelayJob): HTMLElement {
  const card = el('article', 'relay-job relay-job--' + job.status.toLowerCase());

  const head = el('div', 'relay-job__head');
  const title = el('div', 'relay-job__title');
  title.appendChild(el('code', 'relay-job__key', job.idempotencyKey));
  title.appendChild(el('span', 'relay-job__type', TYPE_LABEL[job.type] ?? job.type));
  head.appendChild(title);

  const statusWrap = el('div', 'relay-job__status');
  const pill = el('span', 'relay-pill relay-pill--' + job.status.toLowerCase(),
    STATUS_LABEL[job.status] ?? job.status);
  statusWrap.appendChild(pill);
  if (job.nextAttemptAt && (job.status === 'PENDING' || job.status === 'RETRYING')) {
    statusWrap.appendChild(el('span', 'relay-job__next', `다음 시도 ${fmtUntil(job.nextAttemptAt)}`));
  }
  head.appendChild(statusWrap);
  card.appendChild(head);

  const meta = el('p', 'relay-job__meta');
  meta.appendChild(el('span', undefined, `시드 ${job.seed}`));
  meta.appendChild(el('span', undefined, SCENARIO_LABEL[job.scenario] ?? job.scenario));
  meta.appendChild(el('span', undefined, `최대 ${job.maxAttempts}회`));
  if (job.payload) meta.appendChild(el('span', 'relay-job__payload', job.payload));
  card.appendChild(meta);

  // 시도 이력 - 세대(run)가 바뀌는 지점에 구분선을 넣는다. 재처리 후 타임라인이
  // 이전 세대와 같은 것이 "결정적 재현"의 눈 증명이다.
  const list = el('div', 'relay-job__attempts');
  let lastRun = -1;
  job.attempts.forEach((a) => {
    if (a.run !== lastRun) {
      if (a.run > 0) {
        list.appendChild(el('div', 'relay-run-divider',
          `재처리 ${a.run}번째 세대 - 같은 시드라 타임라인이 같습니다`));
      }
      lastRun = a.run;
    }
    list.appendChild(attemptRow(a));
  });
  if (job.attempts.length === 0) {
    list.appendChild(el('p', 'relay-job__waiting', '아직 시도 전 - 워커가 곧 집어 갑니다.'));
  }
  card.appendChild(list);

  const actions = el('div', 'relay-job__actions');
  if (job.status === 'PENDING' || job.status === 'RETRYING') {
    actions.appendChild(actionBtn('취소', () => postAction(job.id, 'cancel')));
  }
  if (job.status === 'DEAD_LETTER') {
    const btn = actionBtn('수동 재처리', () => postAction(job.id, 'reprocess'));
    btn.title = '멱등 키가 그대로라 재처리가 중복 실행을 만들지 않습니다';
    actions.appendChild(btn);
  }
  const replay = actionBtn('같은 시드로 재생', () => replayJob(job));
  replay.title = '새 키 + 같은 시드로 예약합니다 - 타임라인이 그대로 재현되면 그것이 결정성입니다';
  actions.appendChild(replay);
  card.appendChild(actions);
  return card;
}

function actionBtn(label: string, onClick: () => void): HTMLButtonElement {
  const btn = el('button', 'btn btn--small', label);
  btn.type = 'button';
  btn.addEventListener('click', onClick);
  return btn;
}

function renderJobs(res: RelayJobList): void {
  renderStats(res.stats);
  const wrap = $('#jobList')[0] as HTMLElement;
  wrap.replaceChildren();
  const frag = document.createDocumentFragment();
  res.jobs.forEach((job) => frag.appendChild(jobCard(job)));
  wrap.appendChild(frag);
  $('#jobsEmpty').prop('hidden', res.jobs.length > 0);
}

// ---- API ----------------------------------------------------------------
function load(): void {
  const params = $('#dlqOnly').is(':checked') ? { status: 'DEAD_LETTER' } : {};
  $.getJSON(API.jobs, params, renderJobs)
    .fail(() => { toast('목록을 불러오지 못했습니다.', 'error'); });
}

interface EnqueueBody {
  idempotencyKey: string;
  type: string;
  payload: string | null;
  scenario: string;
  seed: number | null;
  maxAttempts: number;
  publishMode: string;
  failPersist: boolean;
}

function postEnqueue(body: EnqueueBody, onDone?: (res: RelayEnqueueResponse) => void): void {
  $.ajax({
    url: API.jobs, method: 'POST', contentType: 'application/json', data: JSON.stringify(body),
  }).done((res: RelayEnqueueResponse) => {
    onDone?.(res);
    load();
  }).fail((xhr: JQuery.jqXHR) => {
    const p = problemOf(xhr);
    toast(p?.detail ?? '예약에 실패했습니다.', 'error');
  });
}

function postAction(id: number, action: 'cancel' | 'reprocess'): void {
  $.ajax({ url: `${API.jobs}/${id}/${action}`, method: 'POST' })
    .done(() => {
      toast(action === 'cancel' ? '취소했습니다.' : '재처리를 예약했습니다 - 같은 시드로 다시 돕니다.', 'ok');
      load();
    })
    .fail((xhr: JQuery.jqXHR) => {
      const p = problemOf(xhr);
      // 409(ILLEGAL_TRANSITION) = 보던 상태가 낡았다 - 문구를 조립하고 목록을 새로고침한다.
      toast(p?.code === 'ILLEGAL_TRANSITION'
        ? '상태가 이미 바뀌어 처리할 수 없습니다 - 목록을 갱신합니다.'
        : (p?.detail ?? '요청에 실패했습니다.'), 'error');
      load();
    });
}

function quickEnqueue(scenario: string, typeCode: string, label: string): void {
  postEnqueue({
    idempotencyKey: freshKey(), type: typeCode, payload: label, scenario,
    seed: null, maxAttempts: 3, publishMode: 'OUTBOX', failPersist: false,
  }, () => { toast(`예약했습니다 - ${label}`, 'ok'); });
}

function replayJob(job: RelayJob): void {
  postEnqueue({
    idempotencyKey: freshKey(), type: job.type, payload: job.payload,
    scenario: job.scenario, seed: job.seed, maxAttempts: job.maxAttempts,
    publishMode: 'OUTBOX', failPersist: false,
  }, () => { toast(`시드 ${job.seed} 재생 - 같은 타임라인이 다시 그려집니다.`, 'ok'); });
}

// ---- 상세 폼 ------------------------------------------------------------
function detailBody(failPersist: boolean): EnqueueBody {
  const seedRaw = String($('#seedInput').val() ?? '').trim();
  return {
    idempotencyKey: String($('#idemKey').val() ?? '').trim(),
    type: String($('#jobType').val()),
    payload: null,
    scenario: String($('#scenario').val()),
    seed: seedRaw === '' ? null : Number(seedRaw) | 0,
    maxAttempts: Number($('#maxAttempts').val()),
    publishMode: String($('input[name="pubMode"]:checked').val()),
    failPersist,
  };
}

function bumpIdemCounter(res: RelayEnqueueResponse): void {
  idem.req++;
  if (res.duplicate) idem.dup++;
  else if (res.persisted) idem.created++;
  const $c = $('#idemCounter').prop('hidden', false);
  $c.find('[data-c="req"]').text(String(idem.req));
  $c.find('[data-c="created"]').text(String(idem.created));
  $c.find('[data-c="dup"]').text(String(idem.dup));
}

function enqueueFromForm(failPersist: boolean): void {
  const body = detailBody(failPersist);
  if (!body.idempotencyKey) {
    $('#idemKey').val(freshKey());
    body.idempotencyKey = String($('#idemKey').val());
  }
  const ghostBefore = Number($('#ghostCount').text());
  postEnqueue(body, (res) => {
    bumpIdemCounter(res);
    if (!failPersist) {
      toast(res.duplicate ? '같은 키 - 기존 작업을 돌려받았습니다(200, 실행은 1건).' : '예약했습니다.', 'ok');
      return;
    }
    // 저장 실패 주입 - 두 모드의 차이를 문장으로 확정한다(유령 카운터는 폴링이 갱신).
    const direct = body.publishMode === 'DIRECT';
    $('#injectNote').prop('hidden', false).text(direct
      ? `저장 트랜잭션이 굴렀지만 이벤트는 이미 나갔습니다 - 유령 이벤트 ${ghostBefore} → ${ghostBefore + 1}. `
        + '아웃박스 모드로 같은 버튼을 눌러 비교해 보세요.'
      : '저장 트랜잭션이 굴렀고, 같은 트랜잭션의 이벤트도 함께 사라졌습니다 - 유령 0. '
        + '직접 발행 모드로 같은 버튼을 눌러 비교해 보세요.');
  });
}

// ---- 초기화 -------------------------------------------------------------
function fillSelect(id: string, catalog: Record<string, string>): void {
  const select = $(id)[0] as HTMLSelectElement;
  Object.entries(catalog).forEach(([value, label]) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    select.appendChild(opt);
  });
}

/** ?seed=...&scenario=... 딥링크 - 상세 폼을 열고 채운다(재생 링크 공유용). */
function applyQueryReplay(): void {
  const params = new URLSearchParams(location.search);
  const seed = params.get('seed');
  const scenario = params.get('scenario');
  if (!seed && !scenario) return;
  $('#detailPanel').prop('hidden', false);
  if (seed) $('#seedInput').val(seed);
  if (scenario && scenario in SCENARIO_LABEL) $('#scenario').val(scenario);
  toast('딥링크 - 시드와 시나리오를 채웠습니다. 예약을 누르면 같은 타임라인이 재현됩니다.');
}

function startPolling(): void {
  window.clearInterval(polling);
  polling = window.setInterval(() => {
    if (!document.hidden) load();
  }, POLL_MS);
}

$(() => {
  $('.portfolio-home').attr('href', portfolioHomeHref('relay'));
  $('.sibling-screen[data-screen]').each(function () {
    $(this).attr('href', screenHref($(this).data('screen') as Screen));
  });

  fillSelect('#jobType', TYPE_LABEL);
  fillSelect('#scenario', SCENARIO_LABEL);
  $('#idemKey').val(freshKey());

  $('#quickSuccess').on('click', () => quickEnqueue('ALWAYS_SUCCEED', 'RECEIPT_EMAIL', '영수증 메일 발송'));
  $('#quickLucky').on('click', () => quickEnqueue('THIRD_TIME_LUCKY', 'PAYMENT_NOTIFY', '결제 승인 통보'));
  $('#quickFail').on('click', () => quickEnqueue('ALWAYS_FAIL', 'WEBHOOK_PUSH', '파트너 웹훅 전송'));
  $('#openDetail').on('click', () => {
    const panel = $('#detailPanel');
    panel.prop('hidden', !panel.prop('hidden'));
  });
  $('#newKey').on('click', () => { $('#idemKey').val(freshKey()); });
  $('#enqueueBtn').on('click', () => enqueueFromForm(false));
  $('#sameKeyBtn').on('click', () => enqueueFromForm(false));
  $('#failInjectBtn').on('click', () => enqueueFromForm(true));
  $('#dlqOnly').on('change', load);

  applyQueryReplay();
  load();
  startPolling();
});

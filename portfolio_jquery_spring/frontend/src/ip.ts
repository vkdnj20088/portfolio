/*
 * IP 접근 설정 - 어드민 프론트엔드 (TypeScript + jQuery, webpack 별도 엔트리)
 *
 * 설계 메모:
 *  - 시간대 정합(요건 핵심): 서버는 UTC(Instant, ISO ...Z)로 주고받고, 화면은 항상
 *    사용자 디바이스 시간대로 렌더한다(toLocaleString). datetime-local 입력은 브라우저가
 *    디바이스 TZ 로 해석하므로 new Date(value) 로 epoch/UTC 변환하면 서버 TZ 와 무관하게 정확하다.
 *  - 100만 건: 목록은 키셋 커서(nextCursor)로 "더 보기" 한다(OFFSET 없음).
 *  - 사용자 제어 값(IP/설명)은 textContent 로 렌더해 이스케이프(DOM XSS 방지).
 *  - 정확성 > 반응속도: 변경(등록/삭제) 후 목록을 재조회해 화면을 확정한다.
 */
import './styles/ip.scss';
import $ from 'jquery';
import { PORTFOLIO_HOME, siblingScreenHref } from './config';
import { ErrorResponse, IpMatchResponse, IpRuleListResponse, IpRuleResponse, WhoAmIResponse } from './types';
import { buildQuery as buildQueryParams, localToIso } from './lib/ipQuery';

const API = {
  ipRules: '/api/ip-rules',
  whoami: '/api/ip-rules/whoami',
  match: '/api/ip-rules/match',
} as const;
const PAGE_SIZE = 30;

let nextCursor: string | null = null;
let loading = false;
let myIp: string | null = null; // whoami 결과 캐시 - "내 IP 포함" 판정 대상

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

function serverMessage(xhr: JQuery.jqXHR, fallback: string): string {
  const body = xhr.responseJSON as ErrorResponse | undefined;
  return (body && body.message) || fallback;
}

/** ISO(UTC) -> 디바이스 시간대 표기(요건: 항상 접속 디바이스 시간대). */
function fmt(iso: string): string {
  return new Date(iso).toLocaleString('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

// 시간 변환(localToMillis/localToIso)/쿼리 조립은 순수 헬퍼(lib/ipQuery)로 분리해 단위 테스트한다(#O4).

// ---- 목록(키셋 페이지네이션) --------------------------------------------
function makeRow(r: IpRuleResponse): HTMLTableRowElement {
  const tr = document.createElement('tr');
  const td = (text: string, cls?: string): HTMLTableCellElement => {
    const el = document.createElement('td');
    if (cls) el.className = cls;
    el.textContent = text; // 사용자 제어 값 이스케이프
    return el;
  };
  tr.appendChild(td(r.ipAddress, 'num'));
  tr.appendChild(td(r.description));
  tr.appendChild(td(fmt(r.startAt), 'num'));
  tr.appendChild(td(fmt(r.endAt), 'num'));
  const act = document.createElement('td');
  act.className = 'ip-table__act';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn--sm ip-del';
  btn.textContent = 'Delete';
  btn.setAttribute('data-id', String(r.id));
  act.appendChild(btn);
  tr.appendChild(act);
  return tr;
}

// DOM 값을 읽어 순수 조립기에 넘긴다(조립 규칙 자체는 ipQuery.buildQuery 로 단위 테스트).
function buildQuery(reset: boolean): Record<string, string> {
  return buildQueryParams({
    q: String($('#q').val() ?? ''),
    startLocal: String($('#startFrom').val() ?? ''),
    endLocal: String($('#endTo').val() ?? ''),
    cursor: reset ? null : nextCursor,
    pageSize: PAGE_SIZE,
  });
}

function loadList(reset: boolean): void {
  if (loading) return;
  loading = true;
  if (reset) nextCursor = null;
  $.getJSON(API.ipRules, buildQuery(reset), (res: IpRuleListResponse) => {
    const body = $('#ipTableBody')[0] as HTMLElement;
    if (reset) body.replaceChildren();
    const frag = document.createDocumentFragment();
    res.items.forEach((r) => frag.appendChild(makeRow(r)));
    body.appendChild(frag);
    const empty = reset && res.items.length === 0;
    $('#ipEmpty').prop('hidden', !empty);
    nextCursor = res.nextCursor;
    $('#loadMore').prop('hidden', !res.hasMore);
  }).fail(() => { toast('목록을 불러오지 못했습니다.', 'error'); })
    .always(() => { loading = false; });
}

// ---- 등록 폼 ------------------------------------------------------------
function clearForm(): void {
  $('#ipAddress, #description, #startAt, #endAt').val('');
}

function save(): void {
  const ipAddress = String($('#ipAddress').val() ?? '').trim();
  const description = String($('#description').val() ?? '').trim();
  const startAt = localToIso(String($('#startAt').val() ?? ''));
  const endAt = localToIso(String($('#endAt').val() ?? ''));
  // 클라 즉시검증(UX). 서버가 최종 권한(설명 20자/시작<=끝 등 동일 규칙 재검증).
  if (!ipAddress) { toast('IP 주소를 입력해 주세요.', 'error'); return; }
  if (!description) { toast('설명을 입력해 주세요.', 'error'); return; }
  if (description.length > 20) { toast('설명은 최대 20자까지 입력할 수 있습니다.', 'error'); return; }
  if (!startAt || !endAt) { toast('사용 시작/끝 시간을 입력해 주세요.', 'error'); return; }
  if (new Date(endAt).getTime() < new Date(startAt).getTime()) {
    toast('사용 끝 시간은 시작 시간보다 같거나 늦어야 합니다.', 'error'); return;
  }
  $.ajax({
    url: API.ipRules, method: 'POST', contentType: 'application/json',
    data: JSON.stringify({ ipAddress, description, startAt, endAt }),
  }).done(() => {
    $('#addPanel').prop('hidden', true);
    clearForm();
    toast('등록되었습니다.', 'ok');
    loadList(true);
  }).fail((xhr: JQuery.jqXHR) => {
    toast(serverMessage(xhr, '등록에 실패했습니다.'), 'error');
  });
}

// ---- "내 IP 포함" 라이브 배지 -------------------------------------------
// 입력한 규칙(IP/CIDR)이 내 IP 를 포함하는지 서버 /match 로 실시간 판정한다.
// 포함 매칭/정규화는 서버(IpCidr 값객체)를 단일 권한으로 삼는다(클라 IPv6 로직 중복 회피).
function setHint(text: string, kind: 'ok' | 'muted' | 'error'): void {
  $('#ipHint').text(text)
    .removeClass('ip-hint--ok ip-hint--muted ip-hint--error')
    .addClass('ip-hint--' + kind)
    .prop('hidden', false);
}

let hintTimer: number | undefined;
function updateIpHint(): void {
  const rule = String($('#ipAddress').val() ?? '').trim();
  if (!rule) { $('#ipHint').prop('hidden', true); return; }
  if (!myIp) { return; } // whoami 미도착 - 판정 보류(형식 오류로 오해시키지 않음)
  $.getJSON(API.match, { rule, target: myIp })
    .done((res: IpMatchResponse) => {
      const norm = res.normalizedRule !== rule ? ` (${res.normalizedRule})` : '';
      if (res.matches) setHint(`내 IP(${myIp}) 포함${norm}`, 'ok');
      else setHint(`내 IP(${myIp}) 미포함${norm}`, 'muted');
    })
    .fail((xhr: JQuery.jqXHR) => {
      if (xhr.status === 400) setHint('IP/CIDR 형식을 확인해 주세요.', 'error');
    });
}

// ---- 이벤트 바인딩 ------------------------------------------------------
$('#openAdd').on('click', () => { $('#addPanel').prop('hidden', false); });
$('#cancelBtn').on('click', () => {
  $('#addPanel').prop('hidden', true); clearForm(); $('#ipHint').prop('hidden', true);
});
$('#saveBtn').on('click', save);

$('#ipAddress').on('input', () => {
  window.clearTimeout(hintTimer);
  hintTimer = window.setTimeout(updateIpHint, 300); // 디바운스(키 입력당 호출 억제)
});

$('#whoamiBtn').on('click', () => {
  $.getJSON(API.whoami, (res: WhoAmIResponse) => {
    myIp = res.ipAddress;
    $('#ipAddress').val(res.ipAddress);
    updateIpHint();
  }).fail(() => { toast('현재 IP 를 불러오지 못했습니다.', 'error'); });
});

$('#searchBtn').on('click', () => loadList(true));
$('#q').on('keydown', (e: JQuery.KeyDownEvent) => {
  // IME 조합 확정 Enter 는 무시한다 - 한글 검색어 조합을 끝내는 Enter 로 반쯤 확정된 텍스트가 검색되지 않게.
  if ((e.originalEvent as KeyboardEvent | undefined)?.isComposing || e.which === 229) return;
  if (e.key === 'Enter') { e.preventDefault(); loadList(true); }
});
$('#loadMore').on('click', () => loadList(false));

$('#ipTableBody').on('click', '.ip-del', function (this: HTMLElement) {
  const id = $(this).attr('data-id');
  if (!id) return;
  $.ajax({ url: API.ipRules + '/' + id, method: 'DELETE' })
    .done(() => loadList(true))
    .fail((xhr: JQuery.jqXHR) => { toast(serverMessage(xhr, '삭제에 실패했습니다.'), 'error'); });
});

// ---- 초기 로드 ----------------------------------------------------------
$(() => {
  $('.portfolio-home').attr('href', PORTFOLIO_HOME);
  // 나머지 한 화면(파일 확장자 차단)의 주소는 배포 형태마다 달라 런타임에 조립한다.
  $('.sibling-screen').attr('href', siblingScreenHref('ip'));
  // 내 IP 를 미리 캐시(현재 IP 버튼 없이도 "내 IP 포함" 배지가 동작).
  $.getJSON(API.whoami, (res: WhoAmIResponse) => { myIp = res.ipAddress; });
  loadList(true);
});

/*
 * 파일 확장자 차단 - 프론트엔드 (TypeScript + jQuery, webpack 번들)
 *
 * 설계 메모:
 *  - 프론트 검증은 UX 목적, 백엔드 검증은 보안 목적(서버가 최종 권한).
 *    -> 프론트 규칙은 서버(^[a-z0-9]{1,20}$)와 동일하게 유지하되, 통과 여부의 진실원은 서버.
 *  - UX: 보안 설정 기능이므로 "정확성 > 반응속도". 낙관적 업데이트 대신
 *    서버 응답 확정 후 목록을 재조회해 화면을 확정한다.
 *  - jQuery 는 공고 명시 스택이라 그대로 사용하고, TypeScript 로 타입 안전성만 더한다.
 *    (webpack 모듈 스코프가 격리를 보장하므로 기존 IIFE 는 불필요.)
 */
// 스타일을 엔트리에서 import 해 webpack 의존성 그래프에 편입시킨다. 런타임에 JS 가 CSS 를
// 주입하는 게 아니라(그건 CSP 위반), MiniCssExtractPlugin 이 빌드 타임에 별도 .css 로 뽑아낸다.
// -> JS 와 CSS 모두 콘텐츠 해시가 붙고, <link>/<script> 는 HtmlWebpackPlugin 이 주입한다.
import './styles/main.scss';
import $ from 'jquery';
import { PORTFOLIO_HOME, siblingScreenHref } from './config';
import {
  CustomCreatedResponse,
  CustomItem,
  CustomListResponse,
  ErrorResponse,
  FileValidationResponse,
  FixedExtension,
} from './types';

const API = {
  fixed: '/api/extensions/fixed',
  custom: '/api/extensions/custom',
  fileValidate: '/api/files/validate',
} as const;

const VALID = /^[a-z0-9]{1,20}$/;

// ---- 유틸 ---------------------------------------------------------------
function normalizeExt(raw: string): string {
  return (raw || '').trim().toLowerCase().replace(/^\.+/, '').replace(/\.+$/, '');
}

function validateExt(name: string): string | null {
  if (!name) return '확장자를 입력해 주세요.';
  if (name.length > 20) return '확장자는 최대 20자까지 입력할 수 있습니다.';
  if (!VALID.test(name)) return '영문 소문자와 숫자만 사용할 수 있습니다.';
  return null;
}

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

// ---- 고정 확장자 --------------------------------------------------------
function renderFixed(): JQuery.jqXHR {
  return $.getJSON(API.fixed, (list: FixedExtension[]) => {
    // 문자열 결합(.html) 대신 createElement + textContent 로 구성한다(ip.ts:makeRow 와 동일한
    // 출력 이스케이프 패턴). 고정 확장자는 서버 정의 폐집합이라 인젝션 경로는 없지만, 앱 전체에서
    // "값을 마크업에 문자열로 끼우지 않는다"는 규칙을 일관 적용한다.
    // DocumentFragment 에 모아 한 번만 삽입한다(라이브 DOM 에 루프로 append 하면 항목마다 리플로우).
    const frag = document.createDocumentFragment();
    for (const f of list) {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.className = 'fixed-ext';
      input.value = f.name;
      input.checked = f.blocked;
      label.appendChild(input);
      label.appendChild(document.createTextNode(f.name));
      frag.appendChild(label);
    }
    $('#fixedList').empty().append(frag);
  }).fail(() => { toast('고정 확장자를 불러오지 못했습니다.', 'error'); });
}

$('#fixedList').on('change', '.fixed-ext', function (this: HTMLInputElement) {
  const $cb = $(this);
  const name = String($cb.val());
  const blocked = $cb.is(':checked');
  $.ajax({
    url: API.fixed + '/' + encodeURIComponent(name),
    method: 'PATCH',
    contentType: 'application/json',
    data: JSON.stringify({ blocked }),
  }).fail(() => {
    $cb.prop('checked', !blocked); // 서버 확정 실패 -> 원복
    toast('저장에 실패했습니다.', 'error');
  });
});

// ---- 커스텀 확장자 ------------------------------------------------------
function renderCustom(): JQuery.jqXHR {
  return $.getJSON(API.custom, (res: CustomListResponse) => {
    $('#count').text(res.count);
    $('#limit').text(res.limit);
    if (!res.extensions.length) {
      const empty = document.createElement('span');
      empty.className = 'chips__empty';
      empty.textContent = '등록된 커스텀 확장자가 없습니다.';
      $('#customList').empty().append(empty);
      return;
    }
    // DocumentFragment 로 모아 1회 삽입(최대 200개 칩 경로의 항목별 리플로우 제거).
    const frag = document.createDocumentFragment();
    for (const c of res.extensions) frag.appendChild(makeChip(c));
    $('#customList').empty().append(frag);
  }).fail(() => { toast('커스텀 목록을 불러오지 못했습니다.', 'error'); });
}

// 칩 DOM 을 문자열 결합이 아니라 createElement + textContent 로 만든다(ip.ts:makeRow 와 동일한
// 출력 이스케이프 패턴). c.name 은 사용자 입력이라, 서버 [a-z0-9] 화이트리스트 + strict CSP 에
// 더해 여기서도 output-escape 로 XSS 심층 방어를 일관화한다(입력 검증 단일 의존 제거).
function makeChip(c: CustomItem): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'chip';
  span.setAttribute('data-id', String(c.id));
  span.appendChild(document.createTextNode(c.name));
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'chip__x';
  btn.setAttribute('data-id', String(c.id));
  btn.setAttribute('aria-label', '삭제');
  btn.textContent = '×'; // × (기존 &times; 와 동일 문자)
  span.appendChild(btn);
  return span;
}

function addCustom(): void {
  const name = normalizeExt(String($('#extInput').val() ?? ''));
  const err = validateExt(name);
  if (err) { toast(err, 'error'); return; }

  $.ajax({
    url: API.custom,
    method: 'POST',
    contentType: 'application/json',
    data: JSON.stringify({ name }),
  }).done((res: CustomCreatedResponse) => {
    $('#extInput').val('');
    renderCustom();
    toast('추가되었습니다: ' + res.name, 'ok');
  }).fail((xhr: JQuery.jqXHR) => {
    toast(serverMessage(xhr, '추가에 실패했습니다.'), 'error');
  });
}

$('#addBtn').on('click', addCustom);
$('#extInput').on('keydown', (e: JQuery.KeyDownEvent) => {
  // IME 조합 확정 Enter 무시(ip.ts 검색창과 동일 가드). 확장자는 영숫자뿐이라 영향은 작지만 일관성 유지.
  if ((e.originalEvent as KeyboardEvent | undefined)?.isComposing || e.which === 229) return;
  if (e.key === 'Enter') { e.preventDefault(); addCustom(); }
});

$('#customList').on('click', '.chip__x', function (this: HTMLElement) {
  const id = $(this).data('id');
  $.ajax({ url: API.custom + '/' + id, method: 'DELETE' })
    .done(() => { renderCustom(); })
    .fail((xhr: JQuery.jqXHR) => { toast(serverMessage(xhr, '삭제에 실패했습니다.'), 'error'); });
});

// ---- 파일 첨부 검증 데모 ------------------------------------------------
$('#fileBtn').on('click', () => {
  const input = $('#fileInput')[0] as HTMLInputElement;
  if (!input.files || !input.files.length) { toast('파일을 선택해 주세요.', 'error'); return; }

  const fd = new FormData();
  fd.append('file', input.files[0]);

  $.ajax({
    url: API.fileValidate, method: 'POST',
    data: fd, processData: false, contentType: false,
  }).done((res: FileValidationResponse) => {
    // .text()/createTextNode 로 사용자 제어 값(파일명->확장자)을 이스케이프 -> DOM XSS 방지
    const $box = $('#fileResult').removeAttr('hidden')
      .removeClass('file-result--ok file-result--block')
      .addClass(res.allowed ? 'file-result--ok' : 'file-result--block')
      .empty();
    $box.append(document.createTextNode((res.allowed ? '[허용] ' : '[차단] ') + res.reason));
    const parts: string[] = [];
    if (res.extension) parts.push('확장자: ' + res.extension);
    if (res.detectedSignature) parts.push('감지: ' + res.detectedSignature);
    if (parts.length) $box.append($('<small>').text(parts.join(' / ')));
  }).fail(() => {
    toast('검증에 실패했습니다.', 'error');
  });
});

// ---- 초기 로드 ----------------------------------------------------------
$(() => {
  $('.portfolio-home').attr('href', PORTFOLIO_HOME);
  // 나머지 한 화면(IP 접근 제어)의 주소는 배포 형태마다 달라 런타임에 조립한다.
  $('.sibling-screen').attr('href', siblingScreenHref('files'));
  renderFixed();
  renderCustom();
});

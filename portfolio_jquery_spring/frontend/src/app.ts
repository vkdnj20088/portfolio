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
  Problem,
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

/**
 * 실패 응답에서 사용자에게 보여줄 문장을 뽑는다(problem+json).
 * detail 이 표준 필드이고 message 는 이전 형태의 폴백이다 - 배포 시점이 갈려도 빈 문구가 나오지 않게.
 * 던지지 않는다: 에러 처리 경로에서 또 던지면 원래 실패가 파싱 실패로 덮인다.
 */
function serverMessage(xhr: JQuery.jqXHR, fallback: string): string {
  const p = xhr.responseJSON as Problem | undefined;
  const text = p?.detail || p?.message;
  if (!text) return fallback;
  // cid 가 오면 함께 보여준다 - 사용자가 이 값을 전달하면 서버 로그를 바로 찾을 수 있다.
  return p?.cid ? `${text} (요청 ${p.cid})` : text;
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

// ---- 파일 드래그드롭(#G3) -----------------------------------------------
/**
 * 드롭 영역. 파일 선택 input 을 대체하지 않고 감싸기만 한다 - 드래그가 없는 환경에서도
 * 원래 경로가 그대로 동작해야 한다.
 *
 * <b>진행률/취소는 넣지 않았다.</b> 이 데모가 검증하는 파일은 시그니처를 읽을 만큼만 필요해서
 * (수 바이트~수십 KB) 업로드가 한 프레임에 끝난다. 그런 요청에 진행 바를 붙이면 0%에서 100%로
 * 점프하는 장식이 되고, 취소 버튼은 누를 시간이 없다. 없는 지연을 있는 것처럼 보이는 UI 는
 * 기능이 아니라 연출이다.
 */
function bindDropZone(): void {
  const zone = document.getElementById('dropZone');
  const input = document.getElementById('fileInput') as HTMLInputElement | null;
  if (!zone || !input) return;

  /**
   * dragenter/dragleave 는 <b>자식 요소를 지날 때도 발생</b>한다. 그래서 leave 에서 바로
   * 하이라이트를 끄면, 영역 안에서 마우스를 움직이는 동안 테두리가 깜빡인다(자식 경계마다
   * leave->enter 가 한 쌍씩 난다). 진입/이탈 횟수를 세서 0 이 될 때만 끈다 -
   * relatedTarget 을 검사하는 방법도 있지만 섀도 DOM/브라우저 차이에 약하다.
   */
  let depth = 0;
  const setActive = (on: boolean): void => { zone.classList.toggle('dropzone--over', on); };

  // dragover 에서 preventDefault 를 하지 않으면 브라우저가 기본 동작(파일을 새 탭에서 열기)을
  // 수행해 페이지가 사라진다 - 드롭을 받겠다는 선언이 곧 이 preventDefault 다.
  zone.addEventListener('dragover', (e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; // 커서에 "복사" 표시
  });
  zone.addEventListener('dragenter', (e: DragEvent) => {
    e.preventDefault();
    depth += 1;
    setActive(true);
  });
  zone.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (depth === 0) setActive(false);
  });
  zone.addEventListener('drop', (e: DragEvent) => {
    e.preventDefault();
    depth = 0;
    setActive(false);
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    if (files.length > 1) {
      // 검증은 한 번에 한 파일이다. 조용히 첫 파일만 쓰면 사용자는 나머지가 검증된 줄 안다.
      toast(`파일 하나만 검증합니다. 첫 번째(${files[0].name})만 넣었습니다.`);
    }
    // input.files 에 넣어 기존 검증 경로를 그대로 태운다(드롭 전용 분기를 만들지 않는다).
    const dt = new DataTransfer();
    dt.items.add(files[0]);
    input.files = dt.files;
    // 프로그램으로 넣은 값은 change 가 자동으로 나지 않는다 - 아래 리스너가 파일명을 그린다.
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });

  // 파일이 정해지면(선택이든 드롭이든) 무엇이 담겼는지 글로 남긴다.
  input.addEventListener('change', () => {
    const name = input.files?.[0]?.name ?? '';
    const el = document.getElementById('filePicked');
    if (el) el.textContent = name ? `선택된 파일: ${name}` : '';
  });
}

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
  }).fail((xhr: JQuery.jqXHR) => {
    // 서버 문구를 그대로 쓴다 - 벌크헤드/타임아웃은 "검증에 실패" 가 아니라 각각 다른 사정이고,
    // 그 차이를 서버가 이미 detail 에 적어 보낸다(여기서 뭉개면 사용자는 뭘 해야 할지 모른다).
    toast(serverMessage(xhr, '검증에 실패했습니다.'), 'error');
    startRetryCooldown(retryAfterSeconds(xhr));
  });
});

/**
 * 용량 초과(503 CAPACITY) 응답에서 대기 초를 뽑는다.
 *
 * 표준 헤더를 먼저 본다 - `Retry-After` 는 RFC 9110 이고 본문 확장 필드는 우리 규약이다.
 * 둘 다 서버가 같은 값으로 보내지만, 헤더를 먼저 읽는 순서 자체가 "표준이 먼저" 라는 규칙이다.
 * 해당 없는 실패(400/409 등)는 0 을 돌려 대기시키지 않는다.
 */
function retryAfterSeconds(xhr: JQuery.jqXHR): number {
  const header = Number(xhr.getResponseHeader('Retry-After'));
  if (Number.isFinite(header) && header > 0) return Math.ceil(header);
  const body = (xhr.responseJSON as Problem | undefined)?.retryAfterSeconds;
  return typeof body === 'number' && body > 0 ? Math.ceil(body) : 0;
}

/**
 * 검증 버튼을 남은 시간 동안 잠그고 남은 초를 버튼에 적는다.
 *
 * 왜 토스트 문구만으로 끝내지 않는가: 토스트는 2.2초 뒤 사라지는데 대기는 그보다 길 수 있다.
 * 사라진 안내와 여전히 눌리는 버튼이 남으면 사용자는 다시 눌러 같은 거절을 받는다 - 재시도
 * 가능 시점을 아는 쪽(우리)이 버튼 상태로 말해 주는 것이 맞다.
 */
let cooldownTimer: number | undefined;
function startRetryCooldown(seconds: number): void {
  const $btn = $('#fileBtn');
  const label = ($btn.data('label') as string | undefined) ?? $btn.text();
  $btn.data('label', label); // 원래 문구를 한 번만 기억한다(중첩 호출로 "3초 후 재시도" 가 굳지 않게)
  window.clearInterval(cooldownTimer);
  if (seconds <= 0) {
    $btn.prop('disabled', false).text(label);
    return;
  }
  let left = seconds;
  const tick = (): void => {
    if (left <= 0) {
      window.clearInterval(cooldownTimer);
      $btn.prop('disabled', false).text(label);
      return;
    }
    $btn.prop('disabled', true).text(`${left}초 후 재시도`);
    left -= 1;
  };
  tick(); // 첫 프레임을 즉시 반영한다(1초 동안 눌리는 버튼이 남지 않게)
  cooldownTimer = window.setInterval(tick, 1000);
}

// ---- 초기 로드 ----------------------------------------------------------
$(() => {
  $('.portfolio-home').attr('href', PORTFOLIO_HOME);
  // 나머지 한 화면(IP 접근 제어)의 주소는 배포 형태마다 달라 런타임에 조립한다.
  $('.sibling-screen').attr('href', siblingScreenHref('files'));
  bindDropZone();
  renderFixed();
  renderCustom();
});

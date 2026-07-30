/**
 * RFC 7807 / RFC 9457 `application/problem+json` 의 **단일 소비·생산 지점**.
 *
 * 왜 이 파일이 있는가: 이 저장소에는 백엔드가 셋이다(Spring Guard, 챗 라우트 핸들러,
 * 문서QA 라우트 핸들러). 직전까지 세 곳이 서로 다른 형태로 실패를 알렸다 -
 * Spring 은 `{code, message}` 자체 형태, 두 라우트 핸들러는 `new Response('invalid body')`
 * 평문이었다. 성공 응답에는 스키마가 있는데 실패 응답에는 없었다는 뜻이다.
 *
 * 에러도 계약이므로 형태를 하나로 맞추고, 그 형태를 읽고 쓰는 코드를 여기 한 곳에 둔다.
 * 프론트는 `parseProblem()` 하나만 알면 어느 백엔드의 실패든 같은 방식으로 다룬다.
 */

/** 표준 필드 + 이 저장소가 합의한 확장 필드 두 개(code · cid). */
export interface Problem {
  /** 안정 식별자. 이 저장소는 URN 을 쓴다(문서 페이지를 서빙하지 않으므로 죽은 URL 을 박지 않는다). */
  type: string;
  /** 짧은 사람용 요약. 같은 type 이면 같은 title. */
  title: string;
  status: number;
  /** 이 발생 건에 대한 사람용 설명. 화면에 그대로 띄울 수 있는 문장. */
  detail: string;
  /** 이 오류가 난 요청 경로. */
  instance?: string;
  /**
   * 도메인 에러 코드. RFC 에 없는 확장이지만 분기의 근거는 문장이 아니라 코드여야 한다 -
   * detail 은 문구 개선으로 언제든 바뀌고, code 는 안 바뀐다.
   */
  code?: string;
  /** 요청 상관 id. 서버 로그(MDC)와 같은 값이라 사용자가 본 id 로 로그를 바로 찾을 수 있다. */
  cid?: string;
  /** 재시도 가능한 실패(429/503)에서 언제 다시 시도할지. */
  retryAfterSeconds?: number;
}

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/** status 로부터 만드는 최후의 title - 서버가 아무것도 주지 않았을 때만 쓴다. */
function fallbackTitle(status: number): string {
  if (status === 0) return '네트워크 오류';
  if (status === 404) return '대상을 찾을 수 없음';
  if (status === 409) return '동시 수정 충돌';
  if (status === 429) return '요청이 너무 많음';
  if (status >= 500) return '서버 오류';
  if (status >= 400) return '잘못된 요청';
  return '오류';
}

/**
 * detail 이 없을 때의 문구. title 과 달리 <b>상태코드를 붙인다</b> - 서버가 설명을 주지 않은
 * 상황이 곧 진단이 필요한 상황이고, 그때 손에 남는 정보가 상태코드뿐이다.
 * ("잘못된 요청"만 보여 주면 사용자도 개발자도 다음 행동을 정할 수 없다.)
 */
function fallbackDetail(status: number): string {
  return status > 0 ? `${fallbackTitle(status)} (${status})` : fallbackTitle(status);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * 실패 응답을 Problem 으로 정규화한다. **던지지 않는다** - 에러 처리 경로에서 또 던지면
 * 원래 실패 원인이 파싱 실패로 덮인다(디버깅에서 가장 나쁜 종류의 사고다).
 *
 * 서버가 problem+json 을 주면 그대로 쓰고, 평문/HTML/빈 본문이면 status 로 형태를 만든다 -
 * 프록시가 끼어들거나 앱에 도달하기 전에 죽는 경우가 실제로 있으므로 그 경로도 계약 안에 둔다.
 */
export async function parseProblem(res: Response): Promise<Problem> {
  const status = res.status;
  let body: unknown = null;
  let text = '';
  try {
    text = await res.text();
    if (text) body = JSON.parse(text) as unknown;
  } catch {
    // JSON 이 아니면 아래에서 평문으로 다룬다.
  }

  if (isRecord(body)) {
    const retry =
      num(body.retryAfterSeconds) ??
      // 본문에 없으면 헤더를 본다(표준 Retry-After 는 초 또는 HTTP-date - 초만 받는다).
      (() => {
        const h = res.headers.get('Retry-After');
        const n = h ? Number(h) : NaN;
        return Number.isFinite(n) ? n : undefined;
      })();
    return {
      type: str(body.type) ?? 'about:blank',
      title: str(body.title) ?? fallbackTitle(status),
      status: num(body.status) ?? status,
      // Spring 이전 형태(message)도 받아 준다 - 배포 시점이 갈릴 수 있어 한쪽만 먼저 올라가도 깨지지 않는다.
      // detail 이 없으면 status 를 문구에 남긴다. 서버가 아무 설명도 주지 않은 경우가
      // 정확히 진단이 필요한 경우이고, 그때 유일한 정보가 상태코드다.
      detail: str(body.detail) ?? str(body.message) ?? fallbackDetail(status),
      instance: str(body.instance),
      code: str(body.code),
      cid: str(body.cid) ?? str(res.headers.get('X-Request-Id') ?? undefined),
      retryAfterSeconds: retry,
    };
  }

  // 평문/HTML/빈 본문. 평문은 길이를 제한해 그대로 노출한다(잘라내지 않으면 HTML 한 페이지가 토스트에 들어간다).
  const plain = text.trim().slice(0, 200);
  return {
    type: 'about:blank',
    title: fallbackTitle(status),
    status,
    detail: plain && !plain.startsWith('<') ? plain : fallbackDetail(status),
    cid: str(res.headers.get('X-Request-Id') ?? undefined),
  };
}

/**
 * 라우트 핸들러(챗/문서QA)가 실패를 낼 때 쓴다. 서버와 클라이언트가 같은 파일의 같은 타입을
 * 보므로 형태가 갈릴 수 없다 - 계약을 문서로 유지하는 것보다 타입으로 유지하는 편이 안 낡는다.
 */
export function problemResponse(
  status: number,
  code: string,
  title: string,
  detail: string,
  extra?: { retryAfterSeconds?: number; instance?: string },
): Response {
  const body: Problem = {
    type: `urn:problem:${code.toLowerCase().replace(/_/g, '-')}`,
    title,
    status,
    detail,
    code,
    ...(extra?.instance ? { instance: extra.instance } : {}),
    ...(extra?.retryAfterSeconds != null ? { retryAfterSeconds: extra.retryAfterSeconds } : {}),
  };
  const headers: Record<string, string> = { 'content-type': PROBLEM_CONTENT_TYPE };
  if (extra?.retryAfterSeconds != null) headers['Retry-After'] = String(extra.retryAfterSeconds);
  return new Response(JSON.stringify(body), { status, headers });
}

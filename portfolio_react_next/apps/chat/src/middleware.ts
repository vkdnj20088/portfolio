import { NextResponse, type NextRequest } from 'next/server';

/**
 * Content-Security-Policy 를 요청마다 발급한다. 두 종류의 인라인 스크립트를 각각의 방식으로 허용한다:
 *
 *  - Next 자체 인라인 스크립트(하이드레이션 부트스트랩 등): 요청마다 nonce 를 발급해 CSP <b>요청</b>
 *    헤더에 실어 주면 Next 가 자기 script 태그에 그 nonce 를 자동으로 붙인다. 'strict-dynamic' 으로
 *    그 스크립트가 로드하는 청크까지 신뢰가 전파되므로 스크립트 호스트 목록이 필요 없다.
 *  - FOUC 방지 인라인 스크립트(layout): 내용이 결정적이라 sha256 해시로 고정 허용한다. 덕분에 nonce 를
 *    붙이려 스크립트 태그를 건드릴 필요가 없고 홈의 정적 렌더도 유지된다. 스크립트 내용이 바뀌면 아래
 *    해시를 다시 계산해야 한다(layout.tsx 의 UI_STATE_INIT_SCRIPT). 그 정합을 CI 로 강제하는 것이 다음 개선.
 *  - dev 는 React Refresh 가 eval 을 쓰므로 'unsafe-eval' 을 개발 환경에서만 분기로 허용한다.
 */

// layout.tsx 의 UI_STATE_INIT_SCRIPT 를 sha256/base64 로 고정한 값. 스크립트를 수정하면 함께 갱신할 것.
const FOUC_SCRIPT_HASH = "'sha256-iAnkRvpvi9+YujByOPXjtT8CCAqIIOcv9vOCQgVszo0='";

export function middleware(request: NextRequest) {
  // nonce 는 요청마다 추측 불가능해야 하므로 암호학적 난수 16바이트를 base64 로 쓴다
  // (crypto.randomUUID 는 저장소 규칙상 금지 - getRandomValues 로 대체, Chrome 11+).
  const randomBytes = new Uint8Array(16);
  crypto.getRandomValues(randomBytes);
  let binary = '';
  for (const byte of randomBytes) binary += String.fromCharCode(byte);
  const nonce = btoa(binary);
  const dev = process.env.NODE_ENV !== 'production';

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' ${FOUC_SCRIPT_HASH} 'strict-dynamic'${
      dev ? " 'unsafe-eval'" : ''
    }`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');

  // Next 가 이 요청 헤더에서 nonce 를 읽어 자기 스크립트에 적용한다.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('content-security-policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('content-security-policy', csp);
  // CSP 를 보완하는 심층 방어 헤더(스프링 SecurityHeadersFilter 와 동일 값으로 4앱 정합).
  // frame-ancestors 가 클릭재킹을 이미 막지만 구형 브라우저용으로 X-Frame-Options 도 둔다.
  response.headers.set('x-content-type-options', 'nosniff');
  response.headers.set('x-frame-options', 'DENY');
  response.headers.set('referrer-policy', 'no-referrer');
  response.headers.set(
    'permissions-policy',
    'accelerometer=(), autoplay=(), camera=(), display-capture=(), encrypted-media=(), fullscreen=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), usb=(), xr-spatial-tracking=()',
  );
  return response;
}

export const config = {
  // 정적 자산/이미지/파비콘은 인라인 스크립트가 없어 CSP 계산에서 제외한다.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg).*)'],
};

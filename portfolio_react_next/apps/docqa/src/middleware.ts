import { NextResponse, type NextRequest } from 'next/server';

/**
 * 요청마다 Content-Security-Policy 를 발급한다(챗 앱과 동일 정책). 스크립트는 nonce + strict-dynamic 로
 * 엄격히, 스타일은 실용적으로(React 인라인 스타일). 테마 FOUC 인라인 스크립트는 내용이 결정적이라
 * sha256 해시로 고정 허용한다. 스크립트를 수정하면 아래 해시를 다시 계산해야 한다(layout.tsx 의 THEME_INIT).
 */
export const FOUC_SCRIPT_HASH = "'sha256-zV9IoOTdVSp+sKp7LcDlm2h6EqS9zmLqdaseWjHBlys='";

export function middleware(request: NextRequest) {
  const randomBytes = new Uint8Array(16);
  crypto.getRandomValues(randomBytes);
  let binary = '';
  for (const byte of randomBytes) binary += String.fromCharCode(byte);
  const nonce = btoa(binary);
  const dev = process.env.NODE_ENV !== 'production';

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' ${FOUC_SCRIPT_HASH} 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('content-security-policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('content-security-policy', csp);
  // CSP 보완 심층 방어 헤더(4앱 정합 - 스프링 SecurityHeadersFilter/챗 middleware 와 동일 값).
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
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg).*)'],
};

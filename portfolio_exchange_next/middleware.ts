import { NextResponse, type NextRequest } from "next/server";

/**
 * 요청마다 Content-Security-Policy 를 발급한다(#E6). 스크립트는 nonce 로 엄격히,
 * 스타일은 실용적으로 허용한다:
 *
 *  - script-src: 요청별 nonce + 'strict-dynamic'. Next 가 요청 헤더의 CSP 에서 nonce 를 읽어
 *    자기 스크립트(하이드레이션 부트스트랩 등)에 자동으로 붙이고, next-themes 인라인 스크립트는
 *    layout 이 x-nonce 를 읽어 ThemeProvider 에 넘겨 nonce 를 받는다. strict-dynamic 으로 그
 *    스크립트가 로드하는 청크까지 신뢰가 전파돼 호스트 화이트리스트가 필요 없다. XSS 방어의 핵심.
 *  - style-src 'unsafe-inline': React 의 인라인 스타일 속성(호가 depth 바 width, 가상화 스페이서
 *    height 등 동적 레이아웃)은 nonce 로 커버되지 않아 불가피하다. 스타일은 스크립트를 실행할 수
 *    없어 위험이 낮고, 보안상 중요한 script-src 는 엄격히 유지하는 실용적 분리다(이 repo 의 챗 앱과 동일 정책).
 *  - dev 는 React Refresh 가 eval 을 쓰므로 개발 환경에서만 'unsafe-eval' 을 분기 허용한다.
 *
 * per-request nonce 를 스크립트에 실으려면 정적 프리렌더가 아니라 요청 시점 렌더가 필요하다
 * (layout 의 export const dynamic = 'force-dynamic').
 */
export function middleware(request: NextRequest) {
  // 추측 불가능한 nonce - 암호학적 난수 16바이트 base64.
  // getRandomValues 를 쓴다(randomUUID 는 secure context 전용이라 http 로 열면 죽는다).
  const randomBytes = new Uint8Array(16);
  crypto.getRandomValues(randomBytes);
  let binary = "";
  for (const byte of randomBytes) binary += String.fromCharCode(byte);
  const nonce = btoa(binary);
  const dev = process.env.NODE_ENV !== "production";

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("content-security-policy", csp); // Next 가 자기 스크립트에 nonce 적용
  requestHeaders.set("x-nonce", nonce); // layout 이 읽어 next-themes 에 전달

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", csp);
  // CSP 보완 심층 방어 헤더(스프링 SecurityHeadersFilter 와 동일 값으로 4앱 정합).
  // frame-ancestors 가 클릭재킹을 이미 막지만 구형 브라우저용으로 X-Frame-Options 도 둔다.
  response.headers.set("x-content-type-options", "nosniff");
  response.headers.set("x-frame-options", "DENY");
  response.headers.set("referrer-policy", "no-referrer");
  response.headers.set(
    "permissions-policy",
    "accelerometer=(), autoplay=(), camera=(), display-capture=(), encrypted-media=(), fullscreen=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), usb=(), xr-spatial-tracking=()",
  );
  return response;
}

export const config = {
  // 정적 자산/이미지/파비콘은 인라인 스크립트가 없어 CSP 계산에서 제외.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};

/**
 * "포트폴리오로 돌아가기" 고정 버튼의 목적지를 **지금 열려 있는 주소에서 조립**한다.
 * 두 페이지(app.ts / ip.ts)가 이 값을 공유한다.
 *
 * 예전 값은 상수 '/' 였고 "통합 배포에서 인트로가 루트에 온다"를 전제했다. 그 전제가 틀렸다:
 * 이 앱은 인트로와 **다른 주소**에 산다(포트 분리면 :8443, 도메인이면 file./ip./guard. 서브도메인).
 * 그래서 버튼이 인트로가 아니라 이 앱의 루트 = 파일 차단 화면으로 갔다. ip.html 에서 누르면
 * 엉뚱한 데모로 튀는, 겉보기엔 동작하는 종류의 버그였다.
 *
 * 인트로가 데모 링크를 만드는 규칙을 반대로 적용한다:
 *   - 도메인 배포: 데모는 `<앱>.<도메인>` 이므로 **첫 라벨을 떼면** 인트로다.
 *   - 포트 배포:   데모는 `<IP>:<포트>` 이므로 **포트를 떼면**(443) 인트로다.
 *   - 로컬:        인트로 위치를 알 수 없으므로 '/' 를 그대로 둔다(기존 동작 유지).
 *
 * 같은 규칙이 모노레포(@chat/ui 의 portfolioHome)와 거래소(lib/portfolioHome.ts)에도 있다.
 * 세 벌인 이유는 세 프로젝트가 빌드 경계를 공유하지 않아서다 - 규칙을 바꾸면 셋을 함께 고칠 것.
 */
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[?::1\]?)$/;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const FALLBACK = '/';

export function resolvePortfolioHome(hostname: string, protocol: string): string {
  if (protocol === 'file:' || LOCAL_HOST.test(hostname)) return FALLBACK;

  // IP 리터럴에는 SNI 가 없어 서브도메인을 못 쓴다. 인트로는 같은 IP 의 443(포트 표기 없음).
  if (IPV4.test(hostname)) return `https://${hostname}/`;

  // 도메인. `ip.example.dev` -> `example.dev`, `ip.example.co.kr` -> `example.co.kr`.
  // 라벨이 둘뿐이면(이미 apex) 뗄 것이 없다.
  const labels = hostname.split('.');
  const apex = labels.length > 2 ? labels.slice(1).join('.') : hostname;
  return `https://${apex}/`;
}

// hostname/protocol 을 인자로 받는 이유: 브라우저 밖(테스트, 빌드 도구)에서도 규칙을 검증할 수
// 있게 하려는 것이다. location 이 없는 환경에서는 모듈을 불러오는 것만으로 터지지 않게 막는다.
export const PORTFOLIO_HOME =
  typeof location === 'undefined'
    ? FALLBACK
    : resolvePortfolioHome(location.hostname, location.protocol);

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
 * 목적지는 인트로 최상단이 아니라 **데모 목록(#demos)** 이다. 인트로는 자기소개까지 담은 긴 한
 * 장이라 루트로 보내면 목록이 1280x800 기준 2,441px 아래에 있다. 데모를 보고 나온 사람이 다음
 * 데모로 가려면 히어로와 About 을 다시 스크롤해야 했다 - 데모끼리 오가기 어려웠던 실제 원인은
 * 링크가 없어서가 아니라 이 거리였다.
 *
 * 같은 규칙이 모노레포(@chat/ui 의 portfolioHome)와 거래소(lib/portfolioHome.ts)에도 있다.
 * 세 벌인 이유는 세 프로젝트가 빌드 경계를 공유하지 않아서다 - 규칙을 바꾸면 셋을 함께 고칠 것.
 */
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[?::1\]?)$/;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const FALLBACK = '/';
const DEMOS = '#demos';

/**
 * from 은 방금 보고 나온 화면의 키다(인트로 카드의 data-demo 와 같은 값 - 'files' / 'ip' / 'relay').
 * 인트로가 그 카드에 "방금 본 데모" 표식을 달아, 카드 중 무엇이 남았는지 보이게 한다.
 * referrer 로 하지 않는 이유: 복귀 링크를 보내는 표면 모두 `Referrer-Policy: no-referrer` 라
 * document.referrer 가 비어 있다. 표식 하나를 위해 보안 헤더를 푸는 것보다 쿼리 한 개가 싸다.
 */
function introPath(from?: string): string {
  return from ? `/?from=${encodeURIComponent(from)}${DEMOS}` : `/${DEMOS}`;
}

export function resolvePortfolioHome(hostname: string, protocol: string, from?: string): string {
  if (protocol === 'file:' || LOCAL_HOST.test(hostname)) return FALLBACK;

  // IP 리터럴에는 SNI 가 없어 서브도메인을 못 쓴다. 인트로는 같은 IP 의 443(포트 표기 없음).
  if (IPV4.test(hostname)) return `https://${hostname}${introPath(from)}`;

  // 도메인. `ip.example.dev` -> `example.dev`, `ip.example.co.kr` -> `example.co.kr`.
  // 라벨이 둘뿐이면(이미 apex) 뗄 것이 없다.
  const labels = hostname.split('.');
  const apex = labels.length > 2 ? labels.slice(1).join('.') : hostname;
  return `https://${apex}${introPath(from)}`;
}

// 이 앱의 세 화면. 인트로 카드의 data-demo 키와 같은 값을 쓴다(from= 표식 공유).
export type Screen = 'files' | 'ip' | 'relay';

// hostname/protocol 을 인자로 받는 이유: 브라우저 밖(테스트, 빌드 도구)에서도 규칙을 검증할 수
// 있게 하려는 것이다. location 이 없는 환경에서는 모듈을 불러오는 것만으로 터지지 않게 막는다.
// 상수가 아니라 함수인 것은 화면마다 서로 다른 카드이기 때문이다(screenHref 와 같은 형태).
export const portfolioHomeHref = (here: Screen): string =>
  typeof location === 'undefined'
    ? FALLBACK
    : resolvePortfolioHome(location.hostname, location.protocol, here);

/**
 * 다른 화면으로 가는 링크. 세 화면(파일 확장자 차단 / IP 접근 제어 / 작업 릴레이)은
 * **한 애플리케이션**인데 배포에서 서브도메인으로 갈라 두어, 화면끼리 오갈 방법이 없었다.
 * README 가 "한 앱"이라고 적은 것을 화면에서도 확인할 수 있게 배너의 내비가 이 값을 쓴다.
 *
 * 목적지 규칙은 배포 형태마다 다르다:
 *   - 전용 서브도메인 배포(file./ip.): 첫 라벨을 바꾼다. 단 릴레이는 전용 서브도메인이
 *     없으므로(설계: 새 서브도메인 0) 원 주소인 guard.<apex>/relay.html 로 보낸다.
 *   - 그 외(로컬, IP 리터럴, guard.): 같은 출처의 다른 경로. origin 을 그대로 두므로
 *     포트가 보존된다 - 여기서 포트를 떨어뜨리면 인트로로 가 버린다.
 */
const SCREEN_PATH: Record<Screen, string> = { files: '/', ip: '/ip.html', relay: '/relay.html' };

export function resolveScreenHref(hostname: string, origin: string, target: Screen): string {
  const labels = hostname.split('.');
  if (labels.length > 2 && (labels[0] === 'file' || labels[0] === 'ip')) {
    const apex = labels.slice(1);
    if (target === 'relay') return `https://${['guard', ...apex].join('.')}/relay.html`;
    return `https://${[target === 'files' ? 'file' : 'ip', ...apex].join('.')}/`;
  }
  return `${origin}${SCREEN_PATH[target]}`;
}

export const screenHref = (target: Screen): string =>
  typeof location === 'undefined'
    ? SCREEN_PATH[target]
    : resolveScreenHref(location.hostname, location.origin, target);

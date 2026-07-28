/**
 * "포트폴리오로 돌아가기" 링크의 목적지를 **지금 열려 있는 주소에서 조립**한다.
 *
 * 왜 빌드 타임 상수(NEXT_PUBLIC_PORTFOLIO_URL)로 충분하지 않은가:
 * 그 값은 번들에 박혀서, 호스트가 바뀌면 앱을 다시 빌드·배포해야 맞는다. 실제로 IP 로 배포한 뒤
 * 도메인을 붙였더니 세 앱의 복귀 링크가 전부 옛 IP 를 가리켰다. 게다가 도메인은 언젠가 만료되는데
 * 그러면 이 링크만 죽은 주소로 남는다 - IP 로 접속한 방문자에게도 죽은 도메인을 내미는 셈이다.
 *
 * 인트로가 데모 링크를 만드는 방식과 같은 규칙을 반대로 적용한다:
 *   - 도메인 배포: 데모는 `<앱>.<도메인>` 에 있으므로 **첫 라벨을 떼면** 인트로다.
 *   - IP 배포:     데모는 `<IP>:<포트>` 에 있으므로 **포트를 떼면**(443) 인트로다.
 *   - 로컬:        인트로가 어디 떠 있는지 알 수 없으므로 주어진 기본값을 그대로 쓴다.
 *
 * 서버 렌더링 시점에는 window 가 없다. 그때는 fallback 을 돌려주고, 마운트 후 useEffect 에서
 * 실제 값으로 교체한다(usePortfolioHome). 스크립트가 꺼져 있어도 fallback 링크는 살아 있다.
 */
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[?::1\]?)$/;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

export function portfolioHomeHref(fallback: string): string {
  if (typeof window === 'undefined') return fallback;

  const { protocol, hostname } = window.location;
  if (protocol === 'file:' || LOCAL_HOST.test(hostname)) return fallback;

  // IP 리터럴에는 SNI 가 없어 서브도메인을 못 쓴다. 인트로는 같은 IP 의 443(포트 표기 없음).
  if (IPV4.test(hostname)) return `https://${hostname}/`;

  // 도메인. `chat.example.dev` -> `example.dev`, `chat.example.co.kr` -> `example.co.kr`.
  // 라벨이 둘뿐이면(이미 apex) 그대로 둔다 - 뗄 것이 없다.
  const labels = hostname.split('.');
  const apex = labels.length > 2 ? labels.slice(1).join('.') : hostname;
  return `https://${apex}/`;
}

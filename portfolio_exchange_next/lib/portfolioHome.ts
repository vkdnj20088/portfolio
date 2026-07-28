"use client";
import { useSyncExternalStore } from "react";

/**
 * "포트폴리오로 돌아가기" 링크의 목적지를 **지금 열려 있는 주소에서 조립**한다.
 *
 * 왜 빌드 타임 상수(NEXT_PUBLIC_PORTFOLIO_URL)로 충분하지 않은가:
 * 그 값은 번들에 박혀서, 호스트가 바뀌면 앱을 다시 빌드·배포해야 맞는다. 실제로 IP 로 배포한 뒤
 * 도메인을 붙였더니 복귀 링크가 옛 IP 를 가리켰다. 도메인은 언젠가 만료되는데, 그러면 IP 로
 * 접속한 방문자에게 죽은 도메인을 내미는 링크만 남는다.
 *
 * 인트로가 데모 링크를 만드는 규칙을 반대로 적용한다:
 *   - 도메인 배포: 데모는 `<앱>.<도메인>` 이므로 **첫 라벨을 떼면** 인트로다.
 *   - IP 배포:     데모는 `<IP>:<포트>` 이므로 **포트를 떼면**(443) 인트로다.
 *   - 로컬:        인트로 위치를 알 수 없으므로 주어진 기본값을 그대로 쓴다.
 *
 * 모노레포(chat/docqa)에는 같은 로직이 @chat/ui 에 있다. 이 프로젝트는 별도 저장소 구획이라
 * 공유 패키지를 물리지 않아 의도적으로 한 벌 더 둔다(규칙이 바뀌면 양쪽을 함께 고칠 것).
 */
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[?::1\]?)$/;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

export function portfolioHomeHref(fallback: string): string {
  if (typeof window === "undefined") return fallback;

  const { protocol, hostname } = window.location;
  if (protocol === "file:" || LOCAL_HOST.test(hostname)) return fallback;
  if (IPV4.test(hostname)) return `https://${hostname}/`;

  const labels = hostname.split(".");
  const apex = labels.length > 2 ? labels.slice(1).join(".") : hostname;
  return `https://${apex}/`;
}

// 값이 바뀔 일이 없으므로 구독하지 않는다(해지 함수만 돌려준다).
const noop = () => () => {};

/**
 * 복귀 링크의 href. 서버 스냅샷은 fallback, 클라 스냅샷은 현재 호스트에서 조립한 값이다.
 *
 * useEffect + setState 로 하지 않는 이유: 첫 렌더 직후 한 번 더 렌더를 강제하고
 * react-hooks/set-state-in-effect 에도 걸린다. useSyncExternalStore 는 React 가 서버/클라
 * 스냅샷을 직접 가르므로 하이드레이션 불일치 없이 한 번에 올바른 값이 나온다
 * (ThemeToggle 의 useHydrated 와 같은 규칙).
 *
 * getSnapshot 이 매번 새 문자열을 만들어도 안전하다 - React 는 Object.is 로 비교하는데
 * 문자열은 값으로 같으면 같다고 판정한다(무한 렌더 루프가 생기지 않는다).
 */
export function usePortfolioHome(fallback: string): string {
  return useSyncExternalStore(
    noop,
    () => portfolioHomeHref(fallback),
    () => fallback,
  );
}

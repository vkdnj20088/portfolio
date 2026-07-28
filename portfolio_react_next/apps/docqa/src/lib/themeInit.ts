/**
 * 하이드레이션 전(파싱 시점)에 data-theme 을 세팅해 다크/라이트 FOUC 를 막는 인라인 스크립트.
 *
 * 내용이 결정적인 정적 상수라 middleware 의 CSP 에서 sha256 해시로 고정 허용된다(사용자 입력 아님).
 * 이 문자열을 바꾸면 해시도 바꿔야 하는데, 안 바꾸면 프로덕션에서 조용히 차단돼 테마가 깜빡인다 -
 * 그래서 별도 모듈로 빼서 "문자열 <-> 핀 해시" 정합을 테스트가 강제한다(themeInit.test.ts).
 */
export const THEME_INIT =
  '(function(){try{var t=localStorage.getItem("jc-docqa/theme");if(t!=="dark"&&t!=="light"){t=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}document.documentElement.dataset.theme=t;}catch(e){}})();';

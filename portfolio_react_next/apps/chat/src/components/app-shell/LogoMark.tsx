/**
 * 로고 마크 하나만 그리는 조각 - 사이드바 로고와 홈 그리팅이 공유한다.
 * path 를 두 곳에 복사해 두면 획 두께/모양을 고칠 때 반드시 한 곳을 놓친다.
 * 채팅 서비스를 상징하는 말풍선 형태(브랜드 중립).
 */
export function LogoMark({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} focusable="false" aria-hidden="true">
      <path
        d="M4 5.5 H20 A2.5 2.5 0 0 1 22.5 8 V14 A2.5 2.5 0 0 1 20 16.5 H11 L7 19.7 V16.5 H4 A2.5 2.5 0 0 1 1.5 14 V8 A2.5 2.5 0 0 1 4 5.5 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// 하단 내비/테마 토글용 최소 라인 아이콘. 이모지 대신 currentColor 스트로크 SVG 로 담백하게
// (실서비스 거래소 UI 관례). 장식이 아니라 라벨 보조라 aria-hidden 으로 스크린리더에서 감춘다.
import type { SVGProps } from "react";

const base: SVGProps<SVGSVGElement> = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
};

// 거래소 - 캔들 차트
export const IconChart = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M4 20V4M20 20H4" />
    <rect x="7" y="10" width="2.5" height="6" />
    <rect x="14" y="7" width="2.5" height="9" />
  </svg>
);

// 입출금 - 상하 이동
export const IconTransfer = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M8 4v14m0 0-3-3m3 3 3-3M16 20V6m0 0-3 3m3-3 3 3" />
  </svg>
);

// 보유자산 - 막대
export const IconAssets = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M4 20V10M10 20V4M16 20v-8" />
  </svg>
);

// 공지 - 벨
export const IconBell = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6" />
    <path d="M10.5 20a1.5 1.5 0 0 0 3 0" />
  </svg>
);

// 더보기 - 메뉴
export const IconMenu = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);

// 테마 - 해
export const IconSun = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
  </svg>
);

// 테마 - 달
export const IconMoon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M20 14.5A8 8 0 0 1 9.5 4 7 7 0 1 0 20 14.5" />
  </svg>
);

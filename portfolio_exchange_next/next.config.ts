import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * 자립 실행 산출물(server.js + 최소 node_modules). 서버에 소스와 전체 의존성을 두지 않고
   * 이 디렉터리만 통째로 옮겨 `node server.js` 로 띄운다(infra/ 배포 워크플로가 이 산출물을 쓴다).
   * 모노레포가 아니라 단독 프로젝트라 server.js 가 standalone 루트에 놓인다.
   */
  output: 'standalone',

  // 빌드 산출물에 Next.js 버전을 노출하지 않는다.
  poweredByHeader: false,

  /**
   * 이미지 최적화기를 끈다. 이 앱은 next/image 를 한 곳도 쓰지 않는다(차트는 canvas, 아이콘은
   * 인라인 SVG). 그런데 Next 16 의 파일 트레이싱은 최적화기가 쓸 sharp 를 standalone 에 넣고,
   * 그 크기가 산출물의 44%(17.2MB / 38.7MB)였다 - 호출될 수 없는 코드가 배포의 절반 가까이를
   * 차지한 셈이다(실제로 /_next/image 는 어떤 입력에도 400 을 낸다).
   *
   * unoptimized 는 "안 쓴다"를 설정으로 선언하는 쪽이라, 파일을 콕 집어 빼는 것보다 의도가
   * 드러난다. 나중에 next/image 를 쓰게 되면 이 줄을 지우는 것이 곧 활성화다.
   */
  images: { unoptimized: true },

  /**
   * 위에서 최적화기를 껐어도 Next 16 의 파일 트레이싱은 sharp 를 그대로 standalone 에 넣는다
   * (실측: unoptimized 선언 전후 모두 17.2MB). 선언만으로는 산출물이 줄지 않아 명시적으로 뺀다.
   * 최적화기가 꺼져 있으므로 이 모듈은 어떤 경로에서도 로드되지 않는다.
   */
  outputFileTracingExcludes: {
    '*': ['node_modules/sharp/**', 'node_modules/@img/**'],
  },
};

export default nextConfig;

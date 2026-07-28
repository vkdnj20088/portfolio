import type { NextConfig } from 'next';

/**
 * 지원 브라우저는 package.json 의 `browserslist` 로 선언한다(여기가 아니라).
 * Next.js 는 그 값을 읽어 SWC 트랜스파일 타깃을 정하므로, 선언을 바꾸면 산출물이 바뀐다.
 *
 * 기본값이 Chrome 111+ 라서 명시하지 않으면 요구사항(Chrome 88+)을 만족하지 못한다.
 * -> 근거와 검증 방법은 README 의 STEP 1 참고.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,

  /**
   * 배포 산출물을 self-contained 서버로 만든다(.next/standalone/server.js + 최소 node_modules).
   * 전체 node_modules 를 서버로 옮길 필요 없이 standalone + static + public 만 전송하면 된다
   * (infra/ 배포 워크플로가 이 산출물을 쓴다). transpilePackages 로 가져온 워크스페이스
   * 패키지도 트레이싱에 포함된다.
   */
  output: 'standalone',

  /**
   * 워크스페이스 패키지를 소스 그대로 가져다 Next 가 직접 트랜스파일한다.
   * 패키지마다 별도 빌드 단계를 두지 않으므로(= Just-in-Time packages)
   * 패키지를 고쳐도 재빌드 없이 즉시 반영되고, 타깃 브라우저 설정도 앱 한 곳에서 일괄 적용된다.
   * 패키지가 늘어나도 빌드 그래프가 복잡해지지 않는다.
   */
  // 대화 검색(STEP 16)이 chat-domain 을 통해 검색 엔진을 쓰므로 그 패키지도 함께 트랜스파일한다.
  transpilePackages: ['@chat/ui', '@chat/chat-domain', '@chat/search-domain'],

  // 빌드 산출물에 Next.js 버전을 노출하지 않는다.
  poweredByHeader: false,

  typescript: {
    // 타입 오류가 있으면 빌드를 실패시킨다(기본값이지만 의도를 명시).
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: false,
  },
};

export default nextConfig;

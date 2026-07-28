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
};

export default nextConfig;

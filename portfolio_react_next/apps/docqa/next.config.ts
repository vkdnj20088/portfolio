import type { NextConfig } from 'next';

/**
 * 지원 브라우저는 package.json 의 browserslist 로 선언(Chrome 111+). 챗 앱과 동일 정책.
 * 워크스페이스 패키지(@chat/ui, @chat/search-domain)는 소스 그대로 Next 가 트랜스파일한다(JIT packages).
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  transpilePackages: [
    '@chat/ui',
    '@chat/search-domain',
    '@chat/agent-core',
    '@chat/approval-domain',
  ],
  poweredByHeader: false,
  typescript: { ignoreBuildErrors: false },
  // eslint 키는 Next 16 에서 제거됐다. lint 는 turbo 태스크와 CI 가 직접 돌린다(챗 설정 참고).
};

export default nextConfig;

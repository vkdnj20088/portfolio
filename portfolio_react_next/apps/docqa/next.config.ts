import type { NextConfig } from 'next';

/**
 * 지원 브라우저는 package.json 의 browserslist 로 선언(Chrome 88+). 챗 앱과 동일 정책.
 * 워크스페이스 패키지(@chat/ui, @chat/search-domain)는 소스 그대로 Next 가 트랜스파일한다(JIT packages).
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  transpilePackages: ['@chat/ui', '@chat/search-domain'],
  poweredByHeader: false,
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: false },
};

export default nextConfig;

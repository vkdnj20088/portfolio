import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// 앱 UI 계층 테스트 러너(챗 앱과 동일 구성). 검색/MRC 순수 로직은 @chat/search-domain 에서 검증하고,
// 여기서는 렌더 계층(하이라이트 헬퍼 등)만 jsdom + RTL 로 본다.
export default defineConfig({
  esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});

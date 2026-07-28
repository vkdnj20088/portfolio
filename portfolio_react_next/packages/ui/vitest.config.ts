import { defineConfig } from 'vitest/config';

/**
 * 디자인 시스템 프리미티브(Dialog/Toast 등)의 상호작용 테스트 러너.
 * 포커스 트랩/복원, aria, 라이브 리전은 DOM 이 필요하므로 jsdom 에서 돈다.
 * esbuild 자동 런타임으로 파일마다 React import 없이 JSX 를 변환한다(plugin-react 불필요).
 */
export default defineConfig({
  esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});

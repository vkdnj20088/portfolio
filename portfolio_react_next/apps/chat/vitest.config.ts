import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * 앱(웹) 계층의 단위/상호작용 테스트 러너.
 *
 * chat-domain 은 순수 로직이라 node 환경 vitest 로 충분하지만, 이 앱의 테스트는
 * DOM 이벤트(IME 조합/키다운)와 activeElement(포커스 복원)를 다뤄 jsdom 이 필요하다.
 * 다만 레이아웃 실측(scrollHeight)·matchMedia 분기는 jsdom 이 재현하지 못하므로
 * 그 계층(스크롤 앵커링/reduced-motion)은 여기가 아니라 Playwright(e2e/)가 맡는다.
 * -> include 를 src 로 한정해 e2e 스펙이 이 러너에 딸려 오지 않게 한다.
 */
export default defineConfig({
  // 클래식 JSX 변환은 파일마다 React import 를 요구한다. 자동 런타임으로 그 상용구를 없앤다
  // (Babel/plugin-react 없이 esbuild 만으로 - 설치를 가볍게 유지한다).
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

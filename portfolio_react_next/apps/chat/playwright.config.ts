import { defineConfig, devices } from '@playwright/test';

/**
 * 실제 브라우저 계층 테스트.
 *
 * jsdom 은 scrollHeight/clientHeight 를 0 으로, matchMedia 를 스텁으로 처리하므로
 * "스크롤 앵커링"(늘어난 높이만큼 scrollTop 보정)과 "prefers-reduced-motion 분기"는
 * 원천적으로 단위 테스트로 검증할 수 없다. 그 두 규칙만 실제 크로미움에서 실측한다.
 *
 * 로컬 실행은 브라우저 바이너리 설치를 요구한다(pnpm exec playwright install chromium).
 * CI(frontend.yml 의 e2e 잡)가 --with-deps 로 설치해 이 스펙들을 돌린다.
 */
const PORT = 3100;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // 프로덕션 빌드를 그대로 띄워 실사용과 같은 번들에서 검증한다.
  // next 를 직접 호출한다(pnpm run ... -- 의 인자 전달 특성으로 --port 가 어긋나는 것 회피).
  webServer: {
    command: `pnpm run build && pnpm exec next start --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});

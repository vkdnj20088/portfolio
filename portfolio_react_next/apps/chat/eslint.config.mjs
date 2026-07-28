import next from '@chat/eslint-config/next';

// e2e 는 Playwright 러너 전용(브라우저 컨텍스트 코드). 앱 린트 대상에서 제외한다.
export default [...next, { ignores: ['.next/**', 'next-env.d.ts', 'e2e/**'] }];

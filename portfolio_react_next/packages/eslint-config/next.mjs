import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import next from '@next/eslint-plugin-next';
import base from './base.mjs';

/** Next.js 앱용 설정 - 기본 규칙에 React 와 Next 규칙을 더한다. */
export default [
  ...base,
  /*
   * 플러그인 "등록"은 files 제한 없이 둔다.
   *
   * next build 는 플러그인 적용 여부를 판정할 때 소스가 아니라 **설정 파일 자체**
   * (eslint.config.mjs / package.json)에 대해 calculateConfigForFile 을 호출한다.
   * 등록을 files:['**\/*.{ts,tsx}'] 로 좁히면 .mjs 인 설정 파일에는 적용되지 않아
   * "The Next.js plugin was not detected" 경고가 뜬다(규칙은 정상 동작하는데도).
   * -> 등록은 전역, 규칙은 아래에서 소스 파일로 한정한다.
   */
  { plugins: { react, 'react-hooks': reactHooks, '@next/next': next } },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Next 플러그인의 권장 + Core Web Vitals 규칙.
      // 동기 스크립트 삽입, next/head 오용처럼 런타임에야 드러나는 실수를 린트 단계에서 잡는다.
      ...next.configs.recommended.rules,
      ...next.configs['core-web-vitals'].rules,
      // React 17+ 의 새 JSX 변환에서는 React 를 import 할 필요가 없다.
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      // 의존성 배열 누락은 리렌더 버그의 주원인이라 오류로 승격한다.
      'react-hooks/exhaustive-deps': 'error',
    },
  },
];

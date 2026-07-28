import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

/**
 * 모든 패키지가 공유하는 기본 린트 규칙.
 *
 * 20명 이상이 동시에 작업하는 저장소에서 린트 설정을 패키지마다 복사해 두면
 * 시간이 지나며 서로 어긋나고, "왜 내 패키지만 통과하냐"는 논쟁이 생긴다.
 * 규칙을 한 곳에 두고 각 패키지는 확장만 한다.
 */
export default tseslint.config(
  { ignores: ['**/dist/**', '**/.next/**', '**/node_modules/**', '**/coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // 사용하지 않는 변수는 오류로 본다. 단 _ 로 시작하면 의도적 무시로 허용한다.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // any 는 경고로 둔다: 즉시 실패시키면 외부 타입이 부실할 때 우회 압력이 생긴다.
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],

      // ── 지원 브라우저(Chrome 88) 런타임 API 하한 가드 ──────────────────
      // es-check 는 "문법"만 검사한다. crypto.randomUUID() 같은 런타임 API 는 구문상
      // 합법이라 문법 검사와 빌드를 모두 통과한 뒤, 구형 브라우저에서 TypeError 로만
      // 드러난다(트랜스파일러는 문법만 낮출 뿐 API 를 만들어 주지 않는다).
      // -> 하한을 넘는 API 를 린트 단계에서 기계적으로 차단한다.
      'no-restricted-globals': [
        'error',
        {
          name: 'structuredClone',
          message: 'structuredClone 은 Chrome 98+ 라 지원 하한(88)을 넘습니다. 명시적 복사를 쓰세요.',
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'crypto',
          property: 'randomUUID',
          message:
            'crypto.randomUUID 는 Chrome 92+(그리고 secure context 전용)입니다. 자체 id 생성기를 쓰세요.',
        },
        {
          object: 'Object',
          property: 'hasOwn',
          message: 'Object.hasOwn 은 Chrome 93+ 입니다. Object.prototype.hasOwnProperty.call 을 쓰세요.',
        },
        {
          object: 'AbortSignal',
          property: 'timeout',
          message: 'AbortSignal.timeout 은 Chrome 103+ 입니다. setTimeout + abort() 조합을 쓰세요.',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='at']",
          message: '.at() 은 Chrome 92+ 입니다(Array/String 공통). 인덱스 접근으로 대체하세요.',
        },
        {
          selector: "CallExpression[callee.property.name='findLast']",
          message: 'findLast 는 Chrome 97+ 입니다. 역순 순회로 대체하세요.',
        },
        {
          selector: "CallExpression[callee.property.name='findLastIndex']",
          message: 'findLastIndex 는 Chrome 97+ 입니다. 역순 순회로 대체하세요.',
        },
      ],
    },
  },
  // prettier 는 항상 마지막: 포매팅과 충돌하는 규칙을 꺼서 린터와 포매터가 싸우지 않게 한다.
  prettier,
);

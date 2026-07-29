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

      // ── 런타임 API 하한 가드 ────────────────────────────────────────
      // es-check 는 "문법"만 검사한다. crypto.randomUUID() 같은 런타임 API 는 구문상
      // 합법이라 문법 검사와 빌드를 모두 통과한 뒤, 구형 브라우저에서 TypeError 로만
      // 드러난다(트랜스파일러는 문법만 낮출 뿐 API 를 만들어 주지 않는다).
      //
      // 하한이 Chrome 88 이던 시절에는 여기서 다섯 API 를 막았다 - structuredClone(98+),
      // crypto.randomUUID(92+), Object.hasOwn(93+), .at()/findLast(92+/97+),
      // AbortSignal.timeout(103+). 하한이 111 로 올라가면서 **전부 지원 범위 안**에 들어와
      // 금지할 근거가 사라졌으므로 규칙을 걷어냈다.
      //
      // 가드를 지운 것이 아니라 기준이 바뀐 것이다. 하한을 다시 내리면 그 시점의 하한을 넘는
      // API 목록을 여기에 다시 세워야 한다 - 문법 검사(es-check)만으로는 이 층이 비어 있다.
    },
  },
  // prettier 는 항상 마지막: 포매팅과 충돌하는 규칙을 꺼서 린터와 포매터가 싸우지 않게 한다.
  prettier,
);

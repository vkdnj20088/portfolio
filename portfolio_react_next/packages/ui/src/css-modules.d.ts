/**
 * CSS Modules 앰비언트 선언.
 *
 * 앱(Next.js)은 next-env.d.ts 가 이 선언을 제공하지만, 이 패키지는 독립적으로
 * `tsc --noEmit` 타입체크를 돌리므로 자체 선언이 필요하다.
 */
declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>;
  export default classes;
}

/*
 * webpack 은 .scss 를 처리하지만(sass-loader -> css-loader -> MiniCssExtractPlugin),
 * TypeScript 는 .scss 확장자를 모르므로 import 를 에러로 본다.
 *
 * 이 앱의 스타일 import 는 값을 가져오는 게 아니라 **부수효과 전용**이다
 * (webpack 에게 "이 SCSS 를 그래프에 넣고 CSS 로 뽑아라"라고 알리는 역할).
 * CSS Modules 처럼 클래스명을 객체로 받아 쓰지 않으므로 타입은 필요 없다.
 */
declare module '*.scss';

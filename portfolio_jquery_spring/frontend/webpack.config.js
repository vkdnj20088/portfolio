const path = require('path');
const TerserPlugin = require('terser-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CssMinimizerPlugin = require('css-minimizer-webpack-plugin');

/**
 * TypeScript(app.ts) + SCSS + jQuery 4 를 Spring Boot 정적 리소스로 빌드한다.
 *   app.ts        -> static/js/bundle.<hash>.js
 *   styles/*.scss -> static/css/style.<hash>.css   (MiniCssExtractPlugin 이 별도 파일로 추출)
 *   index.html    -> static/index.html             (위 두 파일명을 주입)
 *
 * CSS 를 왜 style-loader 가 아니라 MiniCssExtractPlugin 으로 추출하는가:
 *  - style-loader 는 런타임에 JS 가 <style> 을 만들어 주입한다 = 인라인 스타일이다.
 *    이 앱 CSP 는 `default-src 'self'` 이고 `style-src 'unsafe-inline'` 을 주지 않으므로
 *    브라우저가 차단한다. 즉 추출은 취향이 아니라 **CSP 를 지키는 유일한 선택지**다.
 *  - 부수 효과로 CSS 가 JS 와 분리돼 병렬로 받아지고, 자체 콘텐츠 해시를 갖는다.
 *
 * 프로덕션(`webpack --mode production`) 빌드 하드닝:
 *  - 난독화/축소: Terser mangle(toplevel 포함) + compress -> 식별자 축약, 데드코드 제거.
 *  - 콘솔 제거 : compress.drop_console / drop_debugger 로 console.* / debugger 제거.
 *  - 주석 제거 : 번들 본문의 모든 주석 삭제.
 *  - 라이선스  : extractComments 로 jQuery(MIT) 등 라이선스 주석만 bundle.<hash>.js.LICENSE.txt 로 분리.
 *                -> 본문은 주석 0 으로 비우되 OSS 라이선스 고지는 유지(재배포 안전, MIT 준수).
 *                banner:false 로 "For license information..." 포인터 주석도 남기지 않는다.
 *
 * heavy obfuscator(javascript-obfuscator)는 의도적으로 도입하지 않는다: TS 원본이 저장소에
 * 공개돼 번들 은닉 효과가 없고, 크기, 런타임 비용, 취약성만 커져 프론트엔드에 부적합.
 * -> mangle+compress 수준이 적정 하드닝.
 *
 * CSP 주의: 앱 CSP 는 `default-src 'self'`(= script-src 'self', unsafe-eval 없음)이다.
 * 따라서 eval 기반 devtool(`eval`, `eval-source-map`)이나 webpack-dev-server(HMR)는
 * CSP 에 막힌다. -> 소스맵을 만들지 않는다(`devtool: false`): 단일 번들 + eval/맵 모두 없음.
 */
module.exports = (env, argv) => {
  return {
    // 멀티 페이지: 파일 확장자 차단(bundle) + IP 접근 설정(ip) + 작업 릴레이(relay).
    // 각 페이지는 자체 번들만 로드한다.
    entry: { bundle: './src/app.ts', ip: './src/ip.ts', relay: './src/relay.ts' },
    output: {
      // static/ 전체를 output 으로 잡는다. CSS 가 파이프라인에 들어오면서 산출물이 두 디렉터리
      // (js/, css/)로 나뉘는데, output.path 를 js/ 에 두면 clean 이 css/ 를 청소하지 못해
      // 낡은 해시 CSS 가 빌드마다 쌓인다.
      path: path.resolve(__dirname, '../src/main/resources/static'),
      // 콘텐츠 해시: 내용이 바뀌면 파일명이 바뀐다 -> 캐시 무효화가 자동으로 성립하고,
      // 그래야 비로소 immutable 장기 캐시를 "안전하게" 걸 수 있다(캐시는 그 다음 문제).
      filename: 'js/[name].[contenthash:8].js',
      publicPath: '/',
      // 낡은 해시 산출물 정리. 단 favicon 은 webpack 이 만들지 않는 손관리 자산이라
      // 명시적으로 보존한다(keep 이 없으면 매 빌드마다 삭제된다).
      clean: { keep: /^favicon\./ },
    },
    plugins: [
      // 해시된 번들/스타일 파일명을 HTML 에 주입한다. 손으로 <script src>/<link href> 를 적으면
      // 해시와 어긋난다 - 주입은 이 파이프라인에서 유일하게 옳은 방법이다.
      new HtmlWebpackPlugin({
        template: path.resolve(__dirname, 'src/index.html'),
        filename: 'index.html', // -> src/main/resources/static/index.html
        chunks: ['bundle'],     // 이 페이지(파일 확장자 차단)의 번들만 주입
        inject: 'head',
        scriptLoading: 'defer', // head + defer: 파싱 비블로킹 + 순서/실행시점이 선언적
        // 주의: 산출물에서 <script defer> 가 <link rel=stylesheet> **앞**에 온다. 관례와 반대라
        // 실수처럼 보이지만 의도된 동작이니 되돌리지 말 것. HtmlWebpackPlugin 은 scriptLoading 값에
        // 따라 삽입 위치를 바꾼다 - 'blocking' 이면 CSS 뒤, 논블로킹('defer')이면 CSS 앞.
        // 즉 순서가 로딩 전략에서 파생되므로, 나중에 'blocking' 으로 바꾸면 순서도 알아서 뒤집힌다.
        //
        // 실측으로 확인함(Lighthouse 콜드 로드, 스로틀):
        //   bundle.js(defer)  priority=Low       요청 288ms -> 완료 320ms
        //   style.css         priority=VeryHigh  요청 290ms -> 완료 304ms
        // 브라우저는 태그 위치가 아니라 자원의 역할로 우선순위를 매긴다. CSS 는 2ms 늦게 요청되고도
        // 16ms 먼저 끝난다 -> 소스 순서는 우선순위에 압도된다(프리로드 스캐너가 둘을 동시에 발견하고,
        // HTTP/2 라 멀티플렉싱된다). Lighthouse 의 render-blocking 절감 예상치도 FCP/LCP 모두 0ms.
        // 오히려 롱폴인 번들(29KB)이 CSS(1.5KB)보다 먼저 요청돼 다운로드를 일찍 시작한다.
        // 템플릿의 개발자 주석은 산출물로 내보내지 않는다(view-source 정리 - 하드닝 항목과 동일한 취지).
        // 템플릿 도입 전에는 "주석을 지우면 문서가 사라지는" 트레이드오프였는데,
        // 이제 문서는 소스(frontend/src/index.html)에 남고 산출물만 깨끗해진다.
        minify: {
          removeComments: true,
          collapseWhitespace: false, // 전송량은 gzip 이 처리한다. 나머지는 원본 그대로 둔다
        },
      }),
      // IP 접근 설정(어드민) 페이지 - 별도 엔트리(ip)로 자체 번들만 주입한다(Spring 정적 서빙: /ip.html).
      new HtmlWebpackPlugin({
        template: path.resolve(__dirname, 'src/ip.html'),
        filename: 'ip.html',
        chunks: ['ip'],
        inject: 'head',
        scriptLoading: 'defer',
        minify: { removeComments: true, collapseWhitespace: false },
      }),
      // 작업 릴레이 페이지 - 재시도 파이프라인 데모(Spring 정적 서빙: /relay.html).
      new HtmlWebpackPlugin({
        template: path.resolve(__dirname, 'src/relay.html'),
        filename: 'relay.html',
        chunks: ['relay'],
        inject: 'head',
        scriptLoading: 'defer',
        minify: { removeComments: true, collapseWhitespace: false },
      }),
      new MiniCssExtractPlugin({
        // [name]: 페이지별 CSS(bundle.<hash>.css / ip.<hash>.css / relay.<hash>.css). 각 HTML 은 자기 것만 주입.
        filename: 'css/[name].[contenthash:8].css',
      }),
    ],
    module: {
      rules: [
        { test: /\.ts$/, use: 'ts-loader', exclude: /node_modules/ },
        {
          // 오른쪽에서 왼쪽으로 실행된다: SCSS -> CSS(sass) -> 의존성 해석(css) -> 파일 추출(mini)
          test: /\.scss$/,
          use: [MiniCssExtractPlugin.loader, 'css-loader', 'sass-loader'],
        },
      ],
    },
    resolve: { extensions: ['.ts', '.js'] },
    devtool: false, // 소스맵 미생성(불필요) - eval/맵 없이 단일 번들, CSP 'self' 준수
    optimization: {
      minimize: true,
      minimizer: [
        new TerserPlugin({
          // 라이선스성 주석만 bundle.<hash>.js.LICENSE.txt 로 추출(jQuery MIT 고지 유지), 포인터 배너는 생략
          extractComments: { banner: false },
          terserOptions: {
            compress: {
              drop_console: true,  // console.* 제거
              drop_debugger: true, // debugger 제거
              passes: 2,
            },
            mangle: { toplevel: true }, // 최상위 포함 식별자 난독화(self-번들이라 외부 API 없음 -> 안전)
            // format.comments 는 지정하지 않는다: extractComments 가 라이선스 추출을
            // 관리하도록 두어야 사이드카 파일에 정상 기록된다(본문 주석은 결과적으로 0).
          },
        }),
        // minimizer 를 직접 지정하면 webpack 기본값이 대체되므로, CSS 최소화는 명시해야 한다.
        // (Terser 는 .js 만, 이쪽은 .css 만 건드린다.) SCSS 주석도 여기서 함께 제거된다
        // -> HTML 과 마찬가지로 산출물에는 개발 주석이 남지 않고, 문서는 소스에만 남는다.
        new CssMinimizerPlugin(),
      ],
    },
    performance: { hints: false },
  };
};

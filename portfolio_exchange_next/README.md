# 가상자산 거래소 목업 (거래소 데모)

가상자산 거래소 웹 프론트엔드를 개인 포트폴리오용으로 재구성한 데모입니다.
실시간 트레이딩 UI(호가 20단, 캔들 차트, 주문 폼, 체결내역)와 지갑(입출금),
보유자산(실시간 손익), 다크모드를 담았습니다.

> 이 프로젝트는 실제 서비스를 재구성한 **개인 데모**이며, 실 데이터/상표/엔드포인트를
> 포함하지 않습니다. 모든 시세와 잔고는 더미 데이터이고, 브랜드는 포트폴리오 정체성에 맞춘
> 가상의 "JC Exchange"(Jongeun Choi) 입니다. 화면 상단에 "PORTFOLIO MOCK-UP" 배지를 항상 표시합니다.

## 스택

- Next.js 16 (App Router, Turbopack) / React 19 / TypeScript
- Tailwind CSS v4 (디자인 토큰은 CSS 변수)
- zustand (실시간 스냅샷 상태), decimal.js (KRW 내림 금융 정확성)
- lightweight-charts v5 (캔들 + 거래량 차트)
- next-themes (다크모드 - CSS 변수 이중 팔레트, filter-invert 미사용)

## 실행 방법

개발 서버:

```bash
npm install
npm run dev
```

프로덕션 빌드 + 실행:

```bash
npm run build
npm run start
```

기본 포트는 3000 입니다. 다른 포트로 띄우려면 `npm run start -- -p 3010` 처럼 지정합니다.
접속 후 자동으로 `/exchange/BTC` 로 이동합니다.

## 라우트

- `/exchange/[market]` - 거래소 (BTC/ETH/XRP/SOL/DOGE, 정적 생성). 코인목록 + 차트/체결 + 호가/주문 3열
- `/wallet` - 입출금 (입금 주소/QR/네트워크, 출금 수량/수수료/OTP 안내)
- `/assets` - 보유자산 (실시간 시세 기준 평가금액/손익, 총 수익률)
- `/notice`, `/more` - 공지 / 더보기(테마 설정)

## 구조

```
app/
  layout.tsx              # next/font, Providers(next-themes), AppShell, 데모 배지
  page.tsx                # -> /exchange/BTC 리다이렉트
  globals.css             # 디자인 토큰(라이트/다크 이중 팔레트) + 컴포넌트 스타일
  exchange/[market]/page.tsx   # 서버 컴포넌트 셸(초기 스냅샷 생성)
  wallet/page.tsx / assets/page.tsx / notice/page.tsx / more/page.tsx
components/
  exchange/{CoinList,PriceHeader,PriceChart,OrderBook,OrderForm,TradeHistory}.tsx
  common/{Providers,ThemeToggle,AppShell}.tsx
  assets/AssetsView.tsx / wallet/WalletView.tsx
lib/
  mock/data.ts            # 더미 시장/보유 데이터
  mock/stream.ts          # 싱글턴 mock 스트림(실시간 갱신) - 실 이관 시 WS 매니저로 교체
  rng.ts                  # 결정적 PRNG(mulberry32) + 문자열 시드 - 스트림/테스트 재현성
  engine/                 # 가격-시간 우선 매칭 엔진(순수 TS)
    types.ts              #   도메인 타입 + 주문 생애주기 상태머신 전이 가드
    matchingEngine.ts     #   오더북 + 매칭(지정가/시장가/부분체결/STP) + 취소/스냅샷
  trade/session.ts        # 잔고/포지션/내 주문/내 체결 - 예약회계(순수/테스트가능)
  virtual/window.ts       # 리스트 가상화 핵심 순수 계산(가시 구간 + 스페이서)
  sync/leaderElection.ts  # 멀티탭 리더 선출(순수) - 살아있는 탭 중 최소 id
  sync/marketSource.ts    # 탭 전역 시세 소스(리더=엔진+방송, 팔로워=수신) + useTabRole
  mock/tape.ts            # 결정적 백필(깊은 체결 테이프) - 시드 난수
  a11y/announce.ts        # 스크린리더 시세 요약 문자열
  format.ts               # KRW 내림(floor) 등 포맷
store/marketStore.ts      # zustand + 마켓 구독 훅(useMarketFeed)
store/tradeStore.ts       # zustand - 세션 래핑(주문 접수/시세체결/취소), 결정적 시퀀스
components/exchange/MyOrders.tsx  # 내 주문(미체결)/체결 패널 + onTick 구동
```

## 설계 메모

- 렌더링 경계: 데이터 fetch는 서버(초기 스냅샷), 실시간/이벤트는 클라이언트 잎 컴포넌트만 `"use client"`.
- 실시간: `lib/mock/stream.ts` 싱글턴 엔진이 600ms 마다 가격/호가/체결을 갱신합니다.
  실서비스 이관 시 이 파일만 WebSocket(STOMP) 매니저로 교체하면 소비 컴포넌트는 무수정입니다.
- 등락색은 한국 거래소 관례(상승/매수 = 빨강, 하락/매도 = 파랑)를 따릅니다.
- 다크모드는 `data-theme` 토큰 이중 팔레트로 전환해 차트/이미지 반전 왜곡이 없습니다.
- 금액은 decimal.js 로 계산하고 KRW 는 내림(floor) 정책으로 표기합니다.

## 매칭 엔진 (`lib/engine/`)

표시 전용 목업을 넘어 **주문이 실제로 체결되는** 가격-시간 우선(price-time priority) 한계
오더북 매칭 엔진을 순수 TypeScript 로 구현했습니다. "무엇을 왜":

- **왜 순수/결정적인가** - 엔진은 시계(`Date.now`)도 난수(`Math.random`)도 읽지 않고 호출자가
  넘긴 `id`/`ts` 로만 동작합니다. 덕분에 체결 시나리오가 100% 재현 가능해 단위 테스트로 못박을 수
  있습니다. 같은 맥락에서 `lib/rng.ts` 의 시드 PRNG 로 라이브 mock 스트림까지 결정화했습니다
  (같은 심볼은 항상 같은 가격 흐름).
- **무엇을 증명** - 체결가는 항상 메이커 가격, 가격 우선 + 동일가 FIFO, 지정가/시장가, 부분체결과
  잔량 처리(지정가는 호가 잔류/시장가는 잔량 취소), 자전거래 방지(STP), 주문 생애주기 상태머신
  (`open -> partially_filled -> filled | canceled`, 잘못된 전이는 코드가 차단). 금액/수량은 전 구간
  decimal.js 로 부동소수 오차를 배제합니다.
- **경계 설계** - 엔진 입출력은 문자열/원시값이라 폼 입력/직렬화와 무손실이고, `seedFromLevels()`
  로 목업 호가창을 그대로 매칭 대상 유동성으로 주입합니다.

## 거래 세션 / 주문 배선 (`lib/trade/`, `store/tradeStore.ts`)

주문 폼의 `alert` 스텁을 걷어내고 **주문을 실제로 엔진에 태워** 잔고/포지션/내 주문/체결을 움직이게
했습니다. "무엇을 왜":

- **왜 순수 세션 계층인가** - `lib/trade/session.ts` 는 zustand 와 무관한 순수 함수
  (`submit`/`evaluateResting`/`cancel`)로, 잔고 회계를 React 없이 단위 테스트로 못박습니다. 스토어
  (`tradeStore`)는 이 순수 로직을 얇게 감싸기만 합니다.
- **예약(reservation) 회계** - 지정가 미체결분은 매수=현금 / 매도=코인을 **미리 예약**해 이중 지출을
  막습니다. 접수 시 감당 불가면(주문가능 초과/보유 초과) **아무것도 바꾸지 않고 거절**하고, 나중 체결은
  예약분을 정산, 취소는 예약분을 환급합니다.
- **주문 라이프사이클을 눈에 보이게** - 시장가는 호가를 쓸어담아 즉시 체결(유동성 부족분은 취소),
  지정가는 교차하면 즉시 체결 + 잔량은 미체결로 등록. 시세가 미체결 지정가를 가로지르면
  (`onTick`, 매 틱 1회) `open -> filled` 로 체결됩니다. "내 주문/체결" 패널이 이 상태 전이를 그대로
  보여줍니다.
- **기존 스트림과 공존** - 목업 시세 스트림은 그대로 두고, 주문 시점의 호가 스냅샷을 `seedFromLevels`
  로 엔진에 주입해 정합시킵니다. 결정적 시퀀스(`ts`)라 재현성도 유지됩니다.
- **단순화(정직하게 명시)** - 데모 스코프상 미체결 지정가는 시세 도달 시 잔량 전량을 지정가로 체결한다고
  가정합니다(부분 유동성 미시뮬). 실서비스라면 체결 시점 호가로 재매칭해야 합니다.

## 접근성 (a11y)

실시간 트레이딩 UI 의 접근성 난점은 **"쉬지 않고 바뀌는 값"** 입니다. 순진하게 `aria-live` 를 붙이면
스크린리더가 초당 여러 번 읽어 소음이 됩니다. "무엇을 왜":

- **라이브 리전은 하나, 요약만** - 시세 헤더에 `role="status"`(polite) 리전 하나를 두고, 개별 갱신이
  아니라 "비트코인 95,432,000원 +2.34% 상승" 같은 **요약 문장을 4초에 1회**만 읽습니다
  (`lib/a11y/announce.ts`). 시각용 숫자 시세는 `aria-hidden` 으로 중복 announce 를 막습니다.
- **체결 테이프는 비-live** - 초당 다수 갱신되는 체결 목록에 라이브를 두지 않습니다(소음). 라벨만 달아
  필요 시 둘러보는 정적 표로 남기고, 상태 전달은 요약 리전이 담당합니다.
- **호가창 키보드 조작** - 호가 행을 `<button>` 으로 만들어 **클릭/Enter 동등**하게 그 가격을 주문폼에
  싣습니다(오더북 -> `orderDraftStore` -> 주문폼, 지정가 자동 전환). `aria-label` 로 "매도호가 ...원,
  수량 .... 주문가격으로 입력"을 읽어 주고, `:focus-visible` 로 키보드 포커스를 가시화합니다.
- **주문폼 시맨틱** - 매수/매도/지정가/시장가 토글에 `role="group"`+`aria-pressed`, 비율 버튼에
  "주문가능의 10%" 같은 `aria-label`, 결과 메시지에 `role="status"`.
- **reduced-motion 정합** - `prefers-reduced-motion: reduce` 에서 호가 플래시/입력 흔들림/복귀 버튼
  전환을 끕니다(정보는 텍스트로 남으므로 손실 없음).

## 대량 체결 테이프 가상화 (`lib/virtual/`)

체결 내역을 수천 행 깊이로 확장하고 **외부 라이브러리 없이 windowing** 을 자체 구현했습니다. "무엇을 왜":

- **왜 가상화인가** - 라이브 스트림 위에 시드 난수로 과거 체결 1,200행을 백필해 깊은 테이프를 만들면,
  전부 DOM 에 그릴 경우 스크롤마다 리플로우/재조립 비용이 행 수에 비례해 폭증합니다. **가시영역 +
  오버스캔만** 렌더하면 DOM 노드 수가 전체와 무관하게 **상한 고정**됩니다.
- **무엇을 증명** - `lib/virtual/window.ts` 의 순수 `computeWindow(scrollTop, viewportH, rowH, total,
  overscan)` 가 고정 행 높이에서 O(1) 로 가시 구간 + 위/아래 스페이서 높이를 냅니다(스페이서가 전체
  스크롤 높이를 보존해 스크롤바가 정상). 실측: **전체 1,200여 행이어도 실제 DOM 행은 ~16개로 일정**
  (패널 헤더에 `DOM N행 / 전체 M행` 계측 표시).
- **재조립/프레임 비용 억제** - 스크롤 핸들러는 `requestAnimationFrame` 게이팅으로 프레임당 1회만
  상태를 갱신하고, 새 체결이 앞에 끼어들 때는 스크롤을 앵커링해(맨 위가 아니면 보정) 보던 행이 튀지
  않게 합니다. 백필은 결정적(시드)이라 SSR/CSR 결과가 같아 하이드레이션도 정합합니다.
- **경계 처리** - 맨 위/맨 아래 오버스캔 클램프, 빈 목록/0 높이 방어를 단위 테스트로 못박았습니다.

## 보안 - CSP nonce (`middleware.ts`)

요청마다 nonce 기반 Content-Security-Policy 를 발급합니다. "무엇을 왜":

- **script-src 는 엄격하게** - `'self' 'nonce-<요청별>' 'strict-dynamic'`. Next 가 요청 헤더의 CSP 에서
  nonce 를 읽어 자기 하이드레이션 스크립트에 자동으로 붙이고, next-themes 인라인 스크립트는 layout 이
  `x-nonce` 를 읽어 `ThemeProvider nonce` 로 넘겨 nonce 를 받습니다. `strict-dynamic` 으로 신뢰가 로드
  청크까지 전파돼 호스트 화이트리스트가 필요 없습니다. **XSS 방어의 핵심**이고, 실측 서빙 HTML 의
  **모든 script 태그(18/18)에 nonce** 가 붙고 콘솔 CSP 위반은 **0** 입니다.
- **정적 렌더의 함정과 해법** - per-request nonce 를 스크립트에 실으려면 요청 시점 렌더가 필요합니다.
  정적 프리렌더 HTML 에는 요청별 nonce 를 넣을 수 없어 `strict-dynamic` 이 nonce 없는 스크립트를
  전부 막습니다(하이드레이션 실패). 그래서 `export const dynamic = 'force-dynamic'`(layout)로 요청 렌더를
  고정했습니다 - **트레이드오프: 시장 페이지의 SSG 를 포기**하는 대신 CSP 정합을 얻습니다(데모 규모라
  타당).
- **style-src 'unsafe-inline' 은 실용적 예외** - React 인라인 스타일 속성(호가 depth 바 width, 가상화
  스페이서 height 등 동적 레이아웃)은 nonce 로 커버되지 않습니다(nonce 는 `<style>`/`<script>` 요소용,
  style 속성 비대상). 스타일은 스크립트를 실행할 수 없어 위험이 낮고, 보안상 중요한 script-src 는 엄격히
  유지하는 분리를 택했습니다(이 포트폴리오 챗 앱과 동일 정책).
- **그 외** - `default-src 'self'`, `object-src 'none'`, `base-uri/form-action 'self'`,
  `frame-ancestors 'none'`, `connect/font/img-src 'self'`(next/font 자가호스팅/외부 CDN 없음). dev 는
  React Refresh 의 eval 때문에 `'unsafe-eval'` 을 개발 환경에서만 분기 허용합니다.

## 멀티탭 시세 동기 (`lib/sync/`)

여러 탭이 열려도 **하나의 탭만 시세 엔진을 돌리고 나머지는 그 결과를 공유**하도록 BroadcastChannel 로
동기화했습니다(상단 "동기화 / 리더/팔로워/단독 탭" 배지). "무엇을 왜":

- **왜 리더 하나만 돌리나** - mockEngine 은 심볼 시드라 결정적이지만 각 탭은 시작 시각이 달라 시세 위상이
  어긋납니다. 리더 한 탭만 엔진을 돌려 스냅샷을 방송하고 팔로워는 자기 엔진을 멈추고 그걸 반영하면,
  모든 탭이 **같은 시세를 같은 위상으로** 봅니다(중복 계산도 줄임).
- **리더 선출은 순수 로직** - `lib/sync/leaderElection.ts` 는 시계를 읽지 않고 "살아있는 탭 중 id 최소가
  리더"라는 결정적 규칙만 담아 단위 테스트로 못박습니다(분할뇌 없음). 하트비트 타임아웃으로 죽은 리더를
  감지해 재선출합니다.
- **소스만 교체, 소비는 무변경** - 탭 전역 싱글턴 `marketSource` 가 `mockEngine.subscribe` 와 동일한
  계약을 제공해 `useMarketFeed`(가격/호가)와 체결 테이프가 소스만 바꿔 끼웁니다. **소비 컴포넌트 5종은
  무수정**입니다.
- **페일오버/폴백** - 리더 탭을 닫으면 `pagehide` 의 `bye` + 하트비트 타임아웃으로 다른 탭이 자동
  승격합니다(실측: 리더 종료 -> 남은 탭이 "단독 탭"으로 승격, 시세 지속). BroadcastChannel 미지원
  브라우저는 항상 솔로라 **각 탭이 자기 엔진**을 돌립니다(기존 동작과 동일, 회귀 0).

## 테스트

```bash
npm test          # vitest - 순수 로직(node) + 주문폼 컴포넌트(jsdom, per-file @vitest-environment)
```

- **순수 로직**: 매칭 엔진 13(교차/부분체결/가격-시간 우선/시장가 스윕/유동성 부족/취소/거절/STP/시딩) +
  거래 세션 10(시장가 체결/잔고, 잔고/보유 부족 거절, 지정가 예약, 시세체결, 취소 환급) +
  RNG 5 + a11y 요약 3 + 드래프트 스토어 2 + 가상화 5 + 리더 선출 7.
- **컴포넌트(RTL)**: `OrderForm` 3 - 시장가 매수가 엔진으로 체결되어 잔고 차감/결과 표시, 수량
  없으면 거절/상태 불변. 시세 피드만 목(엔진/타이머 배제)하고 스토어는 실제로 써 **주문 배선(E4)을
  종단 검증**한다(순수 lib 테스트가 못 잡는 UI-스토어-엔진 배선 공백을 닫음).
- 합계 **48개**. `lib/**/*.test.ts`/`store/**/*.test.ts`(node) + `components/**/*.test.tsx`(jsdom).

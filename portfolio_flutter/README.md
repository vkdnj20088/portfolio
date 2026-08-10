# JC Ticker - 실시간 관심종목 (Flutter)

2,000종목 / 초당 최대 15,000건 갱신 feed 위에서 60fps를 유지하는 관심종목 앱입니다.
계층, 상태, 에러 모델을 직접 설계했습니다. 코드와 함께 읽을 문서가 둘 있습니다.
[DESIGN.md](DESIGN.md) 는 설계 결정과 근거를, [PERF.md](PERF.md) 는 병목 분석과
재현 가능한 before/after 수치를 담았습니다.

라이브: **[ticker.jongeunchoi.dev](https://ticker.jongeunchoi.dev/)** (Flutter web 빌드,
정적 서빙). 같은 배포에서 [`?baseline=1`](https://ticker.jongeunchoi.dev/?baseline=1) 을
붙이면 비교용 순진 구현으로 부팅됩니다.

## 구현 범위

| 항목 | 상태 |
|---|---|
| 화면 1 - 목록 (2,000행, 실시간 가격/등락률/거래량, 정지 뱃지) | 완료 |
| 목록 요약 - 표시 종목 수 / 시가총액 합계(실시간) / 등락률 Top-20(라이브) | 완료 |
| 초성 검색 (`ㅎㅂ`->한빛...) + 완성형 부분일치 + 코드 부분일치 | 완료 |
| 화면 2 - 상세 (현재가/등락, 시/고/저, 거래량, 스파크라인, 정지 구분) | 완료 |
| 지연/역순 tick 정합성 / 거래정지 3단 상태 / 스트림 에러 복구 | 완료 (회귀 테스트 포함) |
| baseline(순진 구현) - PERF.md 비교 기준 | 완료 (`--dart-define=BASELINE=true` 또는 web `?baseline=1`) |
| 부하 상한(15,000건/s) 지속 주입 시 여력 측정 | 완료 (PERF.md §6, 처리량 테스트 + `idle15k` 벤치 구간) |
| 실행 중 계측 (초당 수신 tick 대비 행 rebuild 유발 통지) | 완료 (목록 상단, 1초 주기) |
| web 타깃 (wasm 빌드, 시총 합계 BigInt 전환) | 완료 (아래 "웹 데모" 절) |

## 실행 방법

```bash
flutter pub get

# 앱 실행 (성능 확인은 반드시 profile - debug는 실제보다 훨씬 느립니다)
# 목록 상단에 "초당 수신 N건, 행 rebuild 유발 K회" 계측이 1초 주기로 표시됩니다.
# 초당 수천 건이 들어와도 rebuild는 보이는 행의 몫뿐이라는 격차를 실행만 해도
# 확인할 수 있습니다 (수치의 계약은 test/instrumentation_test.dart가 고정).
flutter run --profile -d macos      # 또는 -d chrome / <ios/android 기기>

# baseline(비교용 순진 구현)으로 실행
flutter run --profile -d macos --dart-define=BASELINE=true

# 정적 분석 / 포맷 / 테스트 (단위/위젯 52개 + 성능 회귀 가드 4개)
flutter analyze
dart format --output=none --set-exit-if-changed lib test integration_test test_driver
flutter test

# 부하 상한(15,000건/s 지속) 여력만 따로 보기 - 5초, PERF.md §6-1
flutter test test/throughput_test.dart

# web 빌드 (배포와 같은 플래그. --no-web-resources-cdn 을 빼면 렌더러를 gstatic 에서
# 받아오고, 배포 CSP 는 그 출처를 막으므로 서버에서만 흰 화면이 됩니다)
flutter build web --wasm --no-web-resources-cdn
python3 -m http.server 3060 --directory build/web   # http://localhost:3060
```

### 성능 벤치마크 재현 (PERF.md 수치의 출처)

feed의 `pump()`(결정론적 배치 주입, seed 20260810 고정)를 사용하므로
baseline/개선본이 **바이트 단위로 동일한 tick 수열**을 받습니다.

```bash
# 개선본 (기본: 통지 주기 0ms = 배치 도착 즉시)
flutter drive --driver=test_driver/integration_test.dart \
  --target=integration_test/perf_test.dart -d macos --profile

# baseline
flutter drive --driver=test_driver/integration_test.dart \
  --target=integration_test/perf_test.dart -d macos --profile \
  --dart-define=BASELINE=true

# 통지 주기 스윕 (성능-신선도 트레이드오프 실측, PERF.md §4)
flutter drive --driver=test_driver/integration_test.dart \
  --target=integration_test/perf_test.dart -d macos --profile \
  --dart-define=NOTIFY_MS=50   # 50/100/200으로 반복
```

각 실행은 표준 출력에 `PERF_SUMMARY {...}` JSON 라인(구간별 프레임 build/raster
avg/p50/p90/p99/worst/jank)과 `STORE_STATS {...}`(적용/기각/불변 tick 수)를
남깁니다.

벤치 창은 전면에 두고 실행합니다. 가려지면 raster 에 측정 환경 아티팩트가
생깁니다(PERF.md §1). macOS 에서는 코드사인 오류("resource fork ... not allowed")가
나기도 하는데, `xattr -cr . && flutter clean` 후 재시도해도 반복된다면 저장소가
iCloud 동기화 경로(`~/Documents` 등) 안에 있는지 봅니다. 파일 프로바이더가
디렉터리에 붙이는 FinderInfo 확장속성을 codesign 이 거부하는 것으로, 동기화 밖
경로로 복사하면 같은 소스가 그대로 빌드됩니다.

## 프로젝트 구조

```
lib/
  feed/        결정론적 시세 데이터 소스 - 실피드(WebSocket) 교체 경계
  domain/      순수 Dart 도메인 - Quote(3단 거래 상태), 초성 추출/매칭
  data/        MarketRepository - 유일한 feed 구독, 스트림 에러 흡수/복구 판정
  state/       QuoteStore(정합성/증분 집계/통지 제어) / RankIndex / SearchModel
  ui/          목록/요약/Top-20/검색/상세/스파크라인
  baseline/    PERF.md 비교용 순진 구현 (배치마다 전체 setState + 전량 재계산)
test/          정합성/상태/에러 생존/집계/순위 등가성/초성/위젯 격리/feed 변형/
               신선도/soak 회귀 테스트 + 성능 회귀 가드(마이크로벤치, 처리량, 포화점)
integration_test/  pump() 기반 결정론 프레임 벤치마크
```

설계 요약 (상세는 [DESIGN.md](DESIGN.md)):

- **정합성은 도착 즉시, 화면은 프레임 단위** - tick은 즉시 상태에 반영(종목별
  timestampMs 단조 강제로 역순 tick 기각)하고, 위젯 통지만 제어합니다.
- **rebuild 전파 최소화** - 행은 자기 종목 notifier에만 구독(+RepaintBoundary,
  고정 itemExtent), Top-20 스트립은 순서가 바뀔 때만, 시총 합계는 정수 델타
  누적으로 증분 갱신. 매 tick 전체 재정렬/재합산 경로가 없습니다.
- **검색은 tick과 무관** - 종목명/코드는 불변이므로 초성 인덱스를 1회 구축,
  필터 재계산은 질의 변경 시에만.
- **상세 화면 동안 목록 통지 정지** - feed 구독은 유지한 채 통지 범위만
  해당 종목으로 제한, 복귀 시 일괄 flush.

## flutter analyze / flutter test 결과

작성 시점 기준 전부 통과입니다:

```
$ flutter analyze
No issues found!

$ flutter test
00:08 +56: All tests passed!
```

56개는 단위/위젯 회귀 52개와 성능 회귀 가드 4개입니다. 성능 가드는 수치 라인을
출력하면서 예산을 벗어나면 실패합니다.

- `MICRO_BENCH` - 증분 집계가 전량 재계산보다 느려지면 실패
- `THROUGHPUT_15K` - 상한 부하에서 배치당 비용이 프레임 예산의 1/4을 넘으면 실패
- `SCALE_SWEEP` - 물리적 최대 유입 120k건/s에서 프레임 예산을 넘으면 실패
- `RANK_COST` - 순위 유지가 적용 비용의 최대 항목이 아니게 되면 실패. PERF.md
  §2/§6의 "손잡이는 사실상 하나"라는 판단이 이 전제 위에 있습니다

나머지 회귀 테스트는 feed 파라미터 9개 변형에서의 불변식 검증, `start()` 벽시계
구동 신선도 자동 증명(드래그 중 포함), 200초 분량 soak(tick 회계와 자료구조
상수성), 증분 순위와 전체 정렬의 fuzz 등가성 대조, 백그라운드 통지 정지/복원,
`transientErrorProbability: 0.1` 에서의 구독 생존 검증입니다.

## 웹 데모 - 배포 형태와 한계

이 데모는 아홉 데모 중 처음으로 **서버 프로세스가 없는 앱**입니다. `flutter build
web --wasm` 산출물을 nginx가 정적으로 서빙하고(인트로와 같은 방식), systemd 유닛도
헬스 게이트/롤백도 없습니다 - 갱신 판정은 `flutter_service_worker.js`가 하므로
nginx가 진입 문서와 서비스워커를 no-store로 내보냅니다(infra/nginx 주석 참조).

렌더러(skwasm/CanvasKit)는 **동봉본을 씁니다.** Flutter 기본값은 이것을
`www.gstatic.com` 에서 받아오는 것이라 빌드에 `--no-web-resources-cdn` 을 붙였고,
CSP 도 그 출처를 열지 않았습니다 - 렌더러 코드의 출처가 서드파티 CDN 이 되는 것과
그 CDN 의 가용성에 데모가 묶이는 것을 피하려는 선택입니다(대가는 아래 전송량입니다).

**첫 로드 전송량 (gzip 실측, 배포와 같은 압축 수준):**

| 경로 | 구성 | 전송량 |
|---|---|---|
| WasmGC 지원 브라우저 | main.dart.wasm 733KB + skwasm.wasm 1,499KB + 로더/JS 26KB | **약 2.2MB** |
| 폴백(JS 컴파일) | main.dart.js 698KB + canvaskit.wasm 2,835KB + 로더/JS 6KB | 약 3.5MB |

(nginx 기본 압축 수준 1로는 각각 약 2.5MB / 3.9MB 입니다. 자산이 커서 차이가
무시할 수 없어 ticker 블록만 `gzip_comp_level 6` 으로 올렸습니다.)

Next 데모들(수십~수백 KB)과 자릿수가 다릅니다. 렌더러 엔진을 함께 내려받는
Flutter web 의 구조적 비용이라 줄일 방법이 없어 그대로 적어 둡니다. 파일명에
해시가 없어 immutable 캐시는 걸 수 없지만, 재방문은 304 재검증(본문 0바이트)이라
부담이 없습니다.

**한계와 취한 조치:**

- **SEO 는 사실상 0입니다.** 캔버스 렌더링이라 크롤러가 읽을 텍스트가 없습니다.
  이 데모는 색인 대상이 아니므로(robots disallow, 다른 데모와 동일 정책) 문제로
  보지 않았습니다.
- **스크린리더 시맨틱스는 DOM 기반 데모보다 약합니다.** Flutter web 은 접근성
  트리를 요청 시(화면의 숨은 활성화 버튼) 생성합니다. 고빈도 시세 화면의 제대로 된
  낭독은 갱신 전달이 아니라 주기 요약(throttle) 낭독이라는 별도 설계가 필요해서,
  라벨만 붙이는 시늉은 하지 않았습니다(DESIGN.md §9와 같은 판단).
- **키보드 경로는 동작합니다.** 검색 입력, 행/타일 포커스 이동(Tab)과
  활성화(Enter), 목록 스크롤(방향키)은 Flutter 기본 포커스 시스템을 씁니다.
- **한글 폴백 폰트는 런타임 로드입니다.** 번들에 없는 글리프를 만나면
  fonts.gstatic.com 에서 글리프 구간 단위로 받아옵니다(ticker CSP 가 이 출처만
  허용). 폰트 전체 번들 대안은 항상 수 MB 를 추가해 기각했습니다.
- **시총 합계는 BigInt** - int 델타 누적은 네이티브 전제(합계 ~1.3e17 > JS 정밀
  상한 2^53)였습니다. web 타깃을 추가하며 DESIGN.md §10 표의 해당 행을 실제로
  실행한 변경이고, 예고한 대로 수정 범위는 "소"였습니다(§5).

## 문서

- [DESIGN.md](DESIGN.md) - 계층/경계, 3단 상태 모델, 에러/신선도 정책,
  집계 정책(halt/필터 기준), 초성 검색 설계, **기각한 대안 7건**(성능-정합성
  상충 대안, 모션/플래시 기각 포함), 의존성 판단(런타임 외부 패키지 0개), 의도적 생략,
  **요구 변경별 영향 범위**, 테스트 전략.
- [PERF.md](PERF.md) - 부하 특성 분석과 **적용 비용 내부 분해**, baseline 정의,
  재현 방법, **before/after 프레임 실측**, 통지 주기 스윕(성능-신선도),
  스토어 통계 해석, **부하 상한 15,000건/s에서의 여력**. 수치를 언제 어떤 트리에서
  쟀는지, 측정 방법을 어디서 바꿨는지는 그 문서 §0에 먼저 적어 두었습니다.

읽는 순서는 [DESIGN.md](DESIGN.md) §1(설계 요약 한 장), [PERF.md](PERF.md) §4(실측 표),
[quote_store.dart](lib/state/quote_store.dart)(정합성/집계/통지가 만나는 지점),
[DESIGN.md](DESIGN.md) §8(기각한 대안)을 권합니다.

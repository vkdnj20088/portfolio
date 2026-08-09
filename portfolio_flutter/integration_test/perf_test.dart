import 'dart:convert';
import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:jc_ticker/main.dart';
import 'package:jc_ticker/feed/market_feed.dart';

/// 재현 가능한 프레임 벤치마크 (PERF.md의 수치 출처).
///
/// - feed는 `start()` 대신 **`pump()`** 로 구동한다 - 기본 seed(20260810)로
///   tick 수열이 바이트 단위로 재현되므로 baseline/개선본이 같은 입력을 받는다.
///   (구독은 앱 부팅 시 attach에서 이미 걸리므로 "리스너 먼저" 조건 충족)
/// - 프레임 타이밍은 엔진의 [FrameTiming] 콜백으로 수집하고, 시나리오 단계별로
///   구간을 나눠 요약을 `PERF_SUMMARY` JSON 라인으로 출력한다.
/// - 실행 (macOS, profile - debug 수치는 무의미). 개선본은 아래 그대로,
///   baseline은 `--dart-define=BASELINE=true`, 통지 주기 스윕은
///   `--dart-define=NOTIFY_MS=50|100|200`을 덧붙인다 (PERF.md §1과 동일):
///   flutter drive --driver=test_driver/integration_test.dart \
///     --target=integration_test/perf_test.dart -d macos --profile
void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  binding.framePolicy = LiveTestWidgetsFlutterBindingFramePolicy.fullyLive;

  testWidgets('watchlist 프레임 벤치마크 (pump 기반 결정론 시나리오)', (tester) async {
    final timings = <FrameTiming>[];
    void collect(List<FrameTiming> batch) => timings.addAll(batch);
    binding.addTimingsCallback(collect);

    final feed = MarketFeed();
    final appKey = GlobalKey<WatchlistAppState>();
    await tester.pumpWidget(
      WatchlistApp(key: appKey, feed: feed, autoStart: false),
    );
    await tester.pump(const Duration(milliseconds: 300));

    // 엔진의 timing 배치 전달(최대 ~1초 지연)을 기다려 구간 경계를 정확히 자른다.
    Future<void> flushTimings() async {
      await tester.pump();
      await Future<void>.delayed(const Duration(milliseconds: 1200));
      await tester.pump();
    }

    final mode = kBaselineMode ? 'baseline' : 'optimized';
    // 구간 요약은 구간이 끝날 때마다 즉시 출력한다 - 뒤 구간에서 실패해도
    // 앞 구간의 수치는 보존된다. (출력은 측정 창 밖이라 수치에 영향 없음)
    Future<void> phase(String name, Future<void> Function() body) async {
      await flushTimings();
      final start = timings.length;
      await body();
      await flushTimings();
      final summary = _summarize(name, timings.sublist(start, timings.length));
      // ignore: avoid_print
      print(
        'PERF_SUMMARY ${jsonEncode({'mode': mode, 'notifyMs': kNotifyIntervalMs, ...summary})}',
      );
    }

    // 워밍업 (셰이더/JIT/첫 layout) - 측정에서 제외.
    for (var i = 0; i < 60; i++) {
      feed.pump(1);
      await tester.pump();
    }

    // 1) 정지 화면에 tick만 유입 (200배치 = 약 3.3초 분량).
    await phase('idle', () async {
      for (var i = 0; i < 200; i++) {
        feed.pump(1);
        await tester.pump();
      }
    });

    // 2) tick 유입 중 고속 스크롤 (fling 12회 x 16배치).
    await phase('scroll', () async {
      final list = find.byKey(const Key('watchList'));
      for (var f = 0; f < 12; f++) {
        await tester.fling(list, const Offset(0, -1200), 2500);
        for (var i = 0; i < 16; i++) {
          feed.pump(1);
          await tester.pump();
        }
      }
    });

    // 3) feed 상한 부하: 프레임당 배치 2개를 주입해 유입을 2배로 올린다.
    //    seed의 평균 배치가 125.5건이므로 2배치 x 60프레임 = 약 초당 15,060건 -
    //    합성 tick이 아니라 seed가 만든 진짜 수열(지연/역순/정지 포함)이다.
    //    단서: feed 내부 시계가 배치당 +16ms이므로 이 구간은 가상 시간이 2배로
    //    흐른다 (벽시계 1초에 feed 기준 2초). 부하 재현이 목적이며 신선도 예산은
    //    벽시계 기준 그대로다.
    //    필터가 걸리지 않은 전체 목록 상태에서 재려고 search보다 앞에 둔다.
    await phase('idle15k', () async {
      for (var i = 0; i < 200; i++) {
        feed.pump(2);
        await tester.pump();
      }
    });

    // 4) 초성 검색 필터가 걸린 상태로 tick 유입.
    // 질의는 유니버스에서 실제로 매칭되는 것이어야 한다 - 0건이면 이 구간이 재는 것이
    // "필터 상태의 tick 반영"이 아니라 "빈 목록 렌더"가 되어 버린다. 'ㅎㅂ'는 한빛*
    // 접두 그룹(전체의 1/16)에 걸린다.
    await phase('search', () async {
      await tester.enterText(find.byKey(const Key('searchField')), 'ㅎㅂ');
      await tester.pump(const Duration(milliseconds: 200)); // debounce 경과
      for (var i = 0; i < 200; i++) {
        feed.pump(1);
        await tester.pump();
      }
    });

    // 5) 상세 화면이 떠 있는 동안 (개선본 전용 - baseline은 상세 미구현).
    //    통지 주기 스윕(NOTIFY_MS > 0)에서는 건너뛴다: 통지가 드물면 프레임 자체가
    //    희소해져 구간 표본이 무의미해지고, 스윕 비교는 idle/scroll/idle15k/search로
    //    한다 (PERF.md §4-2). 채택 구성(0ms)에서만 측정한다.
    if (!kBaselineMode && kNotifyIntervalMs == 0) {
      await phase('detail', () async {
        await tester.enterText(find.byKey(const Key('searchField')), '');
        await tester.pump(const Duration(milliseconds: 200));
        // 스크롤 구간에서 목록이 아래로 내려가 있으므로 최상단으로 복귀시킨 뒤
        // 첫 행을 탭한다 (한 번의 대형 drag는 min extent로 clamp된다).
        final list = find.byKey(const Key('watchList'));
        await tester.drag(list, const Offset(0, 400000));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const ValueKey('row-000001')));
        await tester.pumpAndSettle();
        for (var i = 0; i < 150; i++) {
          feed.pump(1);
          await tester.pump();
        }
        await tester.pageBack();
        await tester.pumpAndSettle();
      });
    }

    binding.removeTimingsCallback(collect);

    final store = appKey.currentState!.store;
    if (store != null) {
      // ignore: avoid_print
      print(
        'STORE_STATS ${jsonEncode({'mode': mode, 'notifyMs': kNotifyIntervalMs, 'applied': store.stats.applied, 'rejectedStale': store.stats.rejectedStale, 'unchanged': store.stats.unchanged})}',
      );
    }
  });
}

Map<String, Object> _summarize(String name, List<FrameTiming> frames) {
  if (frames.isEmpty) {
    return {'phase': name, 'frames': 0};
  }
  final build =
      frames.map((f) => f.buildDuration.inMicroseconds / 1000.0).toList()
        ..sort();
  final raster =
      frames.map((f) => f.rasterDuration.inMicroseconds / 1000.0).toList()
        ..sort();
  double pct(List<double> xs, double p) => xs[((xs.length - 1) * p).round()];
  double avg(List<double> xs) => xs.reduce((a, b) => a + b) / xs.length;
  final jank = frames
      .where(
        (f) =>
            f.buildDuration.inMicroseconds > 16667 ||
            f.rasterDuration.inMicroseconds > 16667,
      )
      .length;
  double round2(double v) => (v * 100).round() / 100;
  return {
    'phase': name,
    'frames': frames.length,
    'buildAvgMs': round2(avg(build)),
    'buildP50Ms': round2(pct(build, 0.50)),
    'buildP90Ms': round2(pct(build, 0.90)),
    'buildP99Ms': round2(pct(build, 0.99)),
    'buildWorstMs': round2(build.last),
    'rasterAvgMs': round2(avg(raster)),
    'rasterP90Ms': round2(pct(raster, 0.90)),
    'rasterWorstMs': round2(raster.last),
    'jankFrames': jank,
    'jankPct': round2(jank * 100 / frames.length),
  };
}

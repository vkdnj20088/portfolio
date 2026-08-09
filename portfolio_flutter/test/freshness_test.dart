import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jc_ticker/main.dart';
import 'package:jc_ticker/feed/market_feed.dart';
import 'package:jc_ticker/ui/format.dart';

/// 신선도 요구(보이는 행은 최신 tick 도착 후 200ms 안에 반영)의 자동 증명.
///
/// 신선도 목표 200ms는 벽시계 기준 `start()` 동작에 대한 요구다. pump() 벤치와 달리 여기서는
/// 실제 실행 경로 그대로 `start()`의 Timer.periodic으로 구동한다 - 위젯 테스트의
/// 가상 시계가 타이머를 결정론적으로 발화시키므로, 벽시계 의미론을 유지하면서도
/// CI에서 흔들리지 않는다.
///
/// 단언은 요구보다 강하게 둔다: 매 프레임, 보이는 행의 가격 텍스트가 스토어의
/// **현재 값과 정확히 일치**해야 한다. 이것이 참이면 stale 시간은 항상 1프레임
/// (약 17ms) 이하이므로 200ms 요구는 자동으로 만족된다 (DESIGN.md §4의 "즉시 통지
/// = 프레임 정렬 coalescing" 논지 그대로).
void main() {
  Future<void> assertRowFresh(
    WidgetTester tester,
    WatchlistAppState app,
    int symbolIndex,
  ) async {
    final code = app.store!.symbolAt(symbolIndex).code;
    final latest = formatPrice(app.store!.quoteAt(symbolIndex).price);
    expect(
      find.descendant(
        of: find.byKey(ValueKey('row-$code')),
        matching: find.byKey(ValueKey('price-$code')),
      ),
      findsOneWidget,
    );
    final text = tester.widget<Text>(find.byKey(ValueKey('price-$code')));
    expect(
      text.data,
      latest,
      reason: '보이는 행($code)의 표시 가격이 스토어 최신값과 다름 - 신선도 위반',
    );
  }

  testWidgets('start() 구동 중 보이는 행의 표시 가격은 매 프레임 최신이다 (2초 분량)', (tester) async {
    final feed = MarketFeed();
    final appKey = GlobalKey<WatchlistAppState>();
    // autoStart: true - 실제 앱과 동일하게 Timer.periodic(60Hz)으로 구동한다.
    await tester.pumpWidget(WatchlistApp(key: appKey, feed: feed));
    await tester.pump();

    final app = appKey.currentState!;
    // 60Hz 타이머(16.67ms 주기)가 매 스텝 1회 발화하도록 17ms씩 진행한다.
    for (var frame = 0; frame < 120; frame++) {
      await tester.pump(const Duration(milliseconds: 17));
      await assertRowFresh(tester, app, 0);
    }
    // 2초 동안 tick이 실제로 흘렀는지 확인 (통계가 0이면 위 단언은 공허하다).
    expect(app.store!.stats.applied, greaterThan(1000));

    await tester.pumpWidget(const SizedBox.shrink());
    feed.dispose();
  });

  testWidgets('드래그 제스처가 진행되는 중에도 보이는 행은 매 프레임 최신이다', (tester) async {
    final feed = MarketFeed();
    final appKey = GlobalKey<WatchlistAppState>();
    await tester.pumpWidget(WatchlistApp(key: appKey, feed: feed));
    await tester.pump();
    final app = appKey.currentState!;

    // 목록을 살짝 내려 6번째 행(index 5)을 화면 상단에 두고,
    final list = find.byKey(const Key('watchList'));
    await tester.drag(list, const Offset(0, -280));
    await tester.pump(const Duration(milliseconds: 17));

    // 제스처를 잡은 채 작은 진폭으로 흔들며 - 행이 화면 안에 머무는 동안 -
    // 매 프레임 신선도를 확인한다 (스크롤 중 신선도 요구).
    final gesture = await tester.startGesture(tester.getCenter(list));
    for (var frame = 0; frame < 60; frame++) {
      await gesture.moveBy(Offset(0, frame.isEven ? -6 : 6));
      await tester.pump(const Duration(milliseconds: 17));
      await assertRowFresh(tester, app, 5);
    }
    await gesture.up();
    await tester.pumpAndSettle();

    await tester.pumpWidget(const SizedBox.shrink());
    feed.dispose();
  });
}

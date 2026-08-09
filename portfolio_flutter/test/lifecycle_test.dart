import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jc_ticker/main.dart';
import 'package:jc_ticker/feed/market_feed.dart';
import 'package:jc_ticker/state/quote_store.dart';
import 'package:jc_ticker/ui/format.dart';

import 'helpers.dart';

/// 앱 라이프사이클에 따른 통지 정지/복원 - 상세 화면의 통지 범위 제한과 같은
/// 원리(값 반영은 계속, 통지만 제어)를 백그라운드 구간에 적용한 것의 회귀 테스트.
void main() {
  testWidgets('백그라운드 동안 통지가 멈추고, 값은 계속 반영되며, 복귀 시 일괄 flush된다', (tester) async {
    final feed = MarketFeed();
    final appKey = GlobalKey<WatchlistAppState>();
    await tester.pumpWidget(
      WatchlistApp(key: appKey, feed: feed, autoStart: false),
    );
    await tester.pump();
    final store = appKey.currentState!.store!;

    // 백그라운드 진입 (프레임워크가 검증하는 실제 전이 체인 그대로).
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    await tester.pump();

    var notifications = 0;
    store.quoteListenable(0).addListener(() => notifications++);

    feed.pump(60);
    await tester.pump();
    expect(notifications, 0, reason: '백그라운드 동안 통지가 나가면 안 됨');
    expect(
      store.stats.applied,
      greaterThan(0),
      reason: '값 반영은 백그라운드에서도 계속되어야 함',
    );

    // 복귀: 밀린 통지가 flush되고 화면이 즉시 최신값을 보인다.
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pump(); // 마이크로태스크 flush + rebuild 프레임
    final latest = formatPrice(store.quoteAt(0).price);
    expect(
      find.descendant(
        of: find.byKey(const ValueKey('row-000001')),
        matching: find.text(latest),
      ),
      findsOneWidget,
      reason: '복귀 직후 화면이 최신값이어야 함',
    );

    await tester.pumpWidget(const SizedBox.shrink());
    feed.dispose();
  });

  test('통지 정지 축과 통지 범위 축은 서로를 덮어쓰지 않는다', () async {
    // 시나리오: 상세 화면(범위 {0}) 상태에서 백그라운드 진입/복귀.
    // 복귀 후에도 범위 제한은 그대로 살아 있어야 한다 (두 축의 독립성).
    final store = QuoteStore();
    store.load([
      snapshotEntry('000001', price: 1000),
      snapshotEntry('000002', price: 2000),
    ]);
    var notifyA = 0;
    var notifyB = 0;
    store.quoteListenable(0).addListener(() => notifyA++);
    store.quoteListenable(1).addListener(() => notifyB++);

    store.restrictNotifications({0}); // 상세 진입
    store.setNotificationsPaused(true); // 백그라운드
    store.applyBatch([
      tick('000001', price: 1100, ts: 100, volume: 1),
      tick('000002', price: 2100, ts: 100, volume: 1),
    ]);
    await Future<void>.delayed(Duration.zero);
    expect(notifyA, 0, reason: '정지 중에는 범위 안 종목도 통지 없음');

    store.setNotificationsPaused(false); // 복귀
    await Future<void>.delayed(Duration.zero);
    expect(notifyA, 1, reason: '복귀 flush는 범위 안 종목만');
    expect(notifyB, 0, reason: '범위 제한(상세 화면)은 여전히 유효해야 함');
    expect(store.notifyScope, {0});

    store.dispose();
  });
}

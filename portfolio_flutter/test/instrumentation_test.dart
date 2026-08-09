import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jc_ticker/main.dart';
import 'package:jc_ticker/feed/market_feed.dart';
import 'package:jc_ticker/state/quote_store.dart';

import 'helpers.dart';

/// 계측 카운터의 계약 테스트 - 화면에 보여주는 수치가 실제와 일치해야 한다.
/// (수신 수는 처리 회계의 합, 행 rebuild 수는 "리스너가 붙은 행에 전달된 통지"만)
void main() {
  test('rowNotificationCount는 리스너가 붙은 행의 실제 통지만 센다', () async {
    final store = QuoteStore();
    store.load([
      snapshotEntry('000001', price: 1000),
      snapshotEntry('000002', price: 2000),
      snapshotEntry('000003', price: 3000),
    ]);
    store.quoteListenable(0).addListener(() {}); // 화면에 보이는 행은 1개뿐

    store.applyBatch([
      tick('000001', price: 1100, ts: 100, volume: 1),
      tick('000002', price: 2100, ts: 100, volume: 1), // 리스너 없음 -> 미집계
    ]);
    expect(store.processedTickCount, 2);
    expect(
      store.rowNotificationCount,
      1,
      reason: '리스너 없는 행의 통지는 rebuild를 만들지 않으므로 세지 않는다',
    );

    // 값 불변 tick: 통지 자체가 없으므로 카운트도 늘지 않는다.
    store.applyBatch([tick('000001', price: 1100, ts: 200, volume: 1)]);
    expect(store.processedTickCount, 3);
    expect(store.rowNotificationCount, 1);

    // 지연(기각) tick: 처리 수에는 들지만 rebuild 카운트는 그대로.
    store.applyBatch([tick('000001', price: 900, ts: 50, volume: 0)]);
    expect(store.processedTickCount, 4);
    expect(store.rowNotificationCount, 1);

    // 통지 정지 중에는 세지 않고, 복귀 flush 시 리스너 있는 행만 1회로 센다.
    store.setNotificationsPaused(true);
    store.applyBatch([
      tick('000001', price: 1200, ts: 300, volume: 2),
      tick('000002', price: 2200, ts: 300, volume: 2),
    ]);
    expect(store.rowNotificationCount, 1);
    store.setNotificationsPaused(false);
    await Future<void>.delayed(Duration.zero); // 마이크로태스크 flush
    expect(store.rowNotificationCount, 2, reason: 'flush 경로의 통지도 리스너 있는 행만 집계');

    store.dispose();
  });

  testWidgets('계측 표시가 1초 주기로 실제 수신량을 반영한다', (tester) async {
    final feed = MarketFeed();
    final appKey = GlobalKey<WatchlistAppState>();
    await tester.pumpWidget(
      WatchlistApp(key: appKey, feed: feed, autoStart: false),
    );
    await tester.pump();

    // 첫 샘플 전에는 0 표시.
    expect(find.byKey(const Key('throughputMeter')), findsOneWidget);

    feed.pump(60); // 1초 분량
    await tester.pump(const Duration(seconds: 1)); // 미터 타이머 1회 발화

    final store = appKey.currentState!.store!;
    final text = tester
        .widget<Text>(find.byKey(const Key('throughputMeter')))
        .data!;
    expect(text, contains('초당 수신'));
    // 60배치 분량이 방금 1초 창에 잡혔어야 한다 (0이면 계측이 죽은 것).
    expect(store.processedTickCount, greaterThan(1000));
    expect(text.contains('수신 0건'), isFalse, reason: '유입이 있었는데 0을 표시하면 계측 오류');

    await tester.pumpWidget(const SizedBox.shrink());
    feed.dispose();
  });
}

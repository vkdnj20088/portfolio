import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jc_ticker/domain/quote.dart';
import 'package:jc_ticker/main.dart';
import 'package:jc_ticker/feed/market_feed.dart';
import 'package:jc_ticker/state/quote_store.dart';
import 'package:jc_ticker/ui/format.dart';

import 'helpers.dart';

/// 위젯 계층 회귀 테스트 - rebuild 격리/신선도/상세 화면 통지 범위.
void main() {
  testWidgets('앱이 뜨고 2,000종목 목록/요약/Top-20이 표시된다', (tester) async {
    final feed = MarketFeed();
    final appKey = GlobalKey<WatchlistAppState>();
    await tester.pumpWidget(
      WatchlistApp(key: appKey, feed: feed, autoStart: false),
    );
    await tester.pump();

    expect(find.text('관심종목'), findsOneWidget);
    expect(find.text('2,000'), findsOneWidget); // 표시 종목 수
    expect(find.byKey(const Key('watchList')), findsOneWidget);
    expect(find.byKey(const ValueKey('row-000001')), findsOneWidget);
    expect(find.byKey(const Key('searchField')), findsOneWidget);

    await tester.pumpWidget(const SizedBox.shrink()); // dispose 정리
    feed.dispose();
  });

  testWidgets('tick 반영 신선도: 배치 적용 후 다음 프레임에 보이는 행이 최신값을 표시한다', (tester) async {
    final feed = MarketFeed();
    final appKey = GlobalKey<WatchlistAppState>();
    await tester.pumpWidget(
      WatchlistApp(key: appKey, feed: feed, autoStart: false),
    );
    await tester.pump();

    final store = appKey.currentState!.store!;

    // 1초 분량(60배치)을 결정론적으로 주입 - 스트림 전달(마이크로태스크) 후 1프레임.
    feed.pump(60);
    await tester.pump(); // 이벤트 전달 + notifier 통지
    await tester.pump(); // 통지로 markNeedsBuild된 행의 build 프레임

    // 최상단 행(000001)의 가격 텍스트가 스토어의 최신값과 일치해야 한다.
    // 통지는 배치 도착 즉시이므로 화면 반영 지연은 최대 1프레임(약 16ms) -
    // 200ms 신선도 요구를 큰 여유로 만족한다 (PERF.md §4).
    final latest = formatPrice(store.quoteAt(0).price);
    expect(
      find.descendant(
        of: find.byKey(const ValueKey('row-000001')),
        matching: find.text(latest),
      ),
      findsOneWidget,
    );

    await tester.pumpWidget(const SizedBox.shrink());
    feed.dispose();
  });

  testWidgets('행 rebuild 격리: 다른 종목의 tick으로는 내 행이 rebuild되지 않는다', (
    tester,
  ) async {
    final store = QuoteStore();
    store.load([
      snapshotEntry('000001', price: 1000),
      snapshotEntry('000002', price: 2000),
    ]);

    var buildsA = 0;
    var buildsB = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: Column(
          children: [
            ValueListenableBuilder<Quote>(
              valueListenable: store.quoteListenable(0),
              builder: (_, q, _) {
                buildsA++;
                return Text('A ${q.price}');
              },
            ),
            ValueListenableBuilder<Quote>(
              valueListenable: store.quoteListenable(1),
              builder: (_, q, _) {
                buildsB++;
                return Text('B ${q.price}');
              },
            ),
          ],
        ),
      ),
    );
    expect(buildsA, 1);
    expect(buildsB, 1);

    store.applyBatch([tick('000001', price: 1100, ts: 100, volume: 1)]);
    await tester.pump();

    expect(buildsA, 2, reason: '자기 종목 tick으로는 rebuild');
    expect(buildsB, 1, reason: '남의 종목 tick으로는 rebuild되지 않아야 함');
    expect(find.text('B 2000.0'), findsOneWidget);

    await tester.pumpWidget(const SizedBox.shrink());
    store.dispose();
  });

  testWidgets('상세 화면이 떠 있는 동안 통지 범위가 해당 종목으로 제한되고, 복귀 시 해제된다', (tester) async {
    final feed = MarketFeed();
    final appKey = GlobalKey<WatchlistAppState>();
    await tester.pumpWidget(
      WatchlistApp(key: appKey, feed: feed, autoStart: false),
    );
    await tester.pump();

    final store = appKey.currentState!.store!;
    expect(store.notifyScope, isNull);

    await tester.tap(find.byKey(const ValueKey('row-000001')));
    await tester.pumpAndSettle();
    expect(store.notifyScope, {
      0,
    }, reason: '상세 화면 동안 목록/요약 통지는 멈춰야 함 (값 반영은 계속)');
    expect(find.byKey(const ValueKey('detail-price-000001')), findsOneWidget);

    // 상세가 떠 있는 동안에도 값은 계속 반영된다 (통지만 제한).
    feed.pump(60);
    await tester.pump();
    expect(store.stats.applied, greaterThan(0));

    await tester.pageBack();
    await tester.pumpAndSettle();
    expect(store.notifyScope, isNull, reason: '복귀 시 통지 범위 복원 + 일괄 flush');

    // 복귀 직후 목록이 최신값을 표시한다 (flush 검증).
    final latest = formatPrice(store.quoteAt(0).price);
    expect(
      find.descendant(
        of: find.byKey(const ValueKey('row-000001')),
        matching: find.text(latest),
      ),
      findsOneWidget,
    );

    await tester.pumpWidget(const SizedBox.shrink());
    feed.dispose();
  });

  testWidgets('다크/라이트 토글이 테마를 전환한다 (기본은 다크)', (tester) async {
    final feed = MarketFeed();
    await tester.pumpWidget(WatchlistApp(feed: feed, autoStart: false));
    await tester.pump();

    Brightness brightness() =>
        Theme.of(tester.element(find.byKey(const Key('watchList')))).brightness;

    expect(brightness(), Brightness.dark, reason: '기본 테마는 다크');

    await tester.tap(find.byKey(const Key('themeToggle')));
    await tester.pumpAndSettle();
    expect(brightness(), Brightness.light);

    await tester.tap(find.byKey(const Key('themeToggle')));
    await tester.pumpAndSettle();
    expect(brightness(), Brightness.dark);

    await tester.pumpWidget(const SizedBox.shrink());
    feed.dispose();
  });

  testWidgets('검색 필드 입력이 목록을 필터링한다 (debounce 경과 후)', (tester) async {
    final feed = MarketFeed();
    final appKey = GlobalKey<WatchlistAppState>();
    await tester.pumpWidget(
      WatchlistApp(key: appKey, feed: feed, autoStart: false),
    );
    await tester.pump();

    await tester.enterText(find.byKey(const Key('searchField')), 'ㄷㄹㅎㅎ');
    await tester.pump(const Duration(milliseconds: 200)); // debounce 120ms 경과

    final search = appKey.currentState!.search!;
    expect(search.visibleIndices, isNotEmpty);
    expect(search.visibleIndices.length, lessThan(2000));
    // 첫 매칭 행이 두레화학이어야 한다.
    final store = appKey.currentState!.store!;
    expect(store.symbolAt(search.visibleIndices.first).name, '두레화학');

    await tester.pumpWidget(const SizedBox.shrink());
    feed.dispose();
  });
}

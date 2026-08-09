import 'package:flutter_test/flutter_test.dart';
import 'package:jc_ticker/data/market_repository.dart';
import 'package:jc_ticker/feed/market_feed.dart';
import 'package:jc_ticker/state/quote_store.dart';

import 'helpers.dart';

/// 증분 집계의 정확성 - 브루트포스 전체 재계산과의 등가성 검증.
///
/// 시총 합계는 BigInt 델타 누적, Top-20은 RankIndex(O(log n) 증분)로 유지되는데,
/// 실제 feed 수열(지연/역순/정지 포함)을 흘려 넣어도 "전량 재계산" 결과와
/// 항상 일치해야 한다.
void main() {
  test('증분 시가총액 합계 == 전량 재계산 (BigInt 정밀, 실제 feed 300배치)', () async {
    final feed = MarketFeed(seed: 99);
    final store = QuoteStore();
    MarketRepository(feed: feed, store: store).attach();

    for (var round = 0; round < 6; round++) {
      feed.pump(50);
      await pumpEventQueue();

      var brute = BigInt.zero;
      for (var i = 0; i < store.length; i++) {
        brute += BigInt.from(
          store.quoteAt(i).price.round() * store.symbolAt(i).listedShares,
        );
      }
      expect(
        store.marketCapSum.value,
        brute,
        reason: '증분 합계가 전량 재계산과 어긋나면 안 됨 (round $round)',
      );
    }
  });

  test('Top-20 증분 순위 == 브루트포스 전체 정렬 (실제 feed 300배치)', () async {
    final feed = MarketFeed(seed: 42);
    final store = QuoteStore();
    MarketRepository(feed: feed, store: store).attach();

    for (var round = 0; round < 30; round++) {
      feed.pump(10);
      await pumpEventQueue();

      final rates = [
        for (var i = 0; i < store.length; i++) store.quoteAt(i).changeRate,
      ];
      final brute = List<int>.generate(store.length, (i) => i)
        ..sort((a, b) {
          final byRate = rates[b].compareTo(rates[a]);
          if (byRate != 0) return byRate;
          return store.symbolAt(a).code.compareTo(store.symbolAt(b).code);
        });
      expect(
        store.top20.value,
        brute.take(20).toList(),
        reason: '증분 순위가 전체 정렬과 어긋나면 안 됨 (round $round)',
      );
    }
  });

  test('동률 등락률(clamp ±30% 등)의 순위는 종목코드로 결정적으로 고정된다', () {
    final store = QuoteStore();
    store.load([
      snapshotEntry('000003', price: 1000),
      snapshotEntry('000001', price: 1000),
      snapshotEntry('000002', price: 1000),
    ]);

    // 서로 다른 순서로 같은 등락률(+30%)에 도달시켜도 순위는 코드 오름차순.
    store.applyBatch([tick('000002', price: 1300, ts: 100, volume: 1)]);
    store.applyBatch([tick('000003', price: 1300, ts: 200, volume: 1)]);
    store.applyBatch([tick('000001', price: 1300, ts: 300, volume: 1)]);

    final codes = store.top20.value.map((i) => store.symbolAt(i).code).toList();
    expect(codes, [
      '000001',
      '000002',
      '000003',
    ], reason: '동률은 코드 오름차순 tiebreak - rank thrashing 방지');

    // 값 불변 tick이 더 와도 순서가 흔들리지 않는다.
    store.applyBatch([tick('000002', price: 1300, ts: 400, volume: 1)]);
    final codes2 = store.top20.value
        .map((i) => store.symbolAt(i).code)
        .toList();
    expect(codes2, ['000001', '000002', '000003']);

    store.dispose();
  });

  test('Top-20 notifier는 순서가 바뀔 때만 통지한다', () {
    final store = QuoteStore();
    store.load([
      snapshotEntry('000001', price: 1000),
      snapshotEntry('000002', price: 1000),
    ]);
    var notifications = 0;
    store.top20.addListener(() => notifications++);

    // 1위(000001)의 등락률이 더 커져도 순서는 그대로 -> 통지 없음.
    store.applyBatch([tick('000001', price: 1100, ts: 100, volume: 1)]);
    expect(store.top20.value.first, 0);
    final after1 = notifications;

    store.applyBatch([tick('000001', price: 1200, ts: 200, volume: 2)]);
    expect(notifications, after1, reason: '순서 불변이면 스트립 rebuild 불필요');

    // 000002가 역전하면 순서가 바뀌므로 통지.
    store.applyBatch([tick('000002', price: 1300, ts: 300, volume: 1)]);
    expect(store.top20.value.first, 1);
    expect(notifications, greaterThan(after1));

    store.dispose();
  });
}

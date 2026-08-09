import 'package:flutter_test/flutter_test.dart';
import 'package:jc_ticker/feed/market_feed.dart';
import 'package:jc_ticker/feed/market_models.dart';
import 'package:jc_ticker/state/quote_store.dart';

/// CPU 마이크로벤치 - 소비 계층의 순수 연산 비용 측정 (PERF.md §2의 보조 수치).
///
/// 주의: `flutter test`는 debug(JIT)로 돌므로 절대값이 아니라 **상대 비교**
/// (증분 집계 vs 전량 재계산)와 자릿수 감각을 위한 것이다. 프레임 수치는
/// integration_test(profile)가 기준이다.
///
/// 항상 같은 수치가 재현되도록 feed 기본 seed + pump()만 사용한다.
void main() {
  test('600배치 적용 비용: 증분 집계 vs 전량 재계산 (수치 출력)', () async {
    // 1) 같은 입력을 두 소비자에 공평하게 주기 위해 배치를 먼저 캡처한다.
    final feed = MarketFeed();
    final snapshot = feed.initialSnapshot();
    final captured = <List<QuoteTick>>[];
    final sub = feed.ticks.listen(captured.add);
    feed.pump(600); // 10초 분량
    await pumpEventQueue();
    await sub.cancel();
    expect(captured.length, 600);
    final totalTicks = captured.fold<int>(0, (sum, b) => sum + b.length);

    // 2) 본 구현: QuoteStore(증분 시총 + RankIndex + 종목별 notifier).
    final store = QuoteStore();
    store.load(snapshot);
    final swStore = Stopwatch()..start();
    for (final batch in captured) {
      store.applyBatch(batch);
    }
    swStore.stop();

    // 3) baseline 상당: 배치마다 도착순 반영 + 시총 전량 재합산 + 전체 정렬.
    final price = <String, double>{};
    final prevClose = <String, double>{};
    final shares = <String, int>{};
    for (final e in snapshot) {
      price[e.info.code] = e.price;
      prevClose[e.info.code] = e.previousClose;
      shares[e.info.code] = e.info.listedShares;
    }
    final codes = snapshot.map((e) => e.info.code).toList();
    final swNaive = Stopwatch()..start();
    for (final batch in captured) {
      for (final t in batch) {
        price[t.code] = t.price;
      }
      var mcap = 0.0;
      for (final c in codes) {
        mcap += price[c]! * shares[c]!;
      }
      double rateOf(String c) =>
          (price[c]! - prevClose[c]!) / prevClose[c]! * 100;
      final ranked = [...codes]..sort((a, b) => rateOf(b).compareTo(rateOf(a)));
      final top20 = ranked.take(20).toList();
      // 컴파일러가 죽은 코드로 제거하지 못하도록 두 결과를 모두 소비한다.
      if (mcap.isNaN || top20.length != 20) fail('unreachable');
    }
    swNaive.stop();

    final storeUsPerBatch = swStore.elapsedMicroseconds / captured.length;
    final naiveUsPerBatch = swNaive.elapsedMicroseconds / captured.length;
    // ignore: avoid_print
    print(
      'MICRO_BENCH ticks=$totalTicks batches=${captured.length} '
      'store_total_ms=${swStore.elapsedMilliseconds} '
      'store_us_per_batch=${storeUsPerBatch.toStringAsFixed(1)} '
      'naiveagg_total_ms=${swNaive.elapsedMilliseconds} '
      'naiveagg_us_per_batch=${naiveUsPerBatch.toStringAsFixed(1)} '
      'stats=${store.stats}',
    );

    // 회귀 가드: 증분 집계가 전량 재계산보다 확연히 싸야 한다.
    expect(
      swStore.elapsedMicroseconds,
      lessThan(swNaive.elapsedMicroseconds),
      reason: '증분 집계가 전량 재계산보다 느리면 설계 회귀',
    );

    store.dispose();
    feed.dispose();
  });
}

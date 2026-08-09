import 'package:flutter_test/flutter_test.dart';
import 'package:jc_ticker/domain/quote.dart';
import 'package:jc_ticker/feed/market_models.dart';
import 'package:jc_ticker/state/quote_store.dart';

import 'helpers.dart';

/// 지연/역순 tick 정합성 회귀 테스트.
///
/// feed는 일부 tick을 지연시켜 "더 작은 timestampMs를 달고 나중에" 보낸다.
/// 도착 순서만 믿으면 가격/거래량이 과거로 되돌아간다 - 스토어는 종목별
/// timestampMs 단조 증가를 강제해 이를 tick 단위로 기각해야 한다.
void main() {
  group('QuoteStore 역순 tick 기각', () {
    late QuoteStore store;

    setUp(() {
      store = QuoteStore();
      store.load([
        snapshotEntry('000001', price: 1000),
        snapshotEntry('000002', price: 2000),
      ]);
    });

    tearDown(() => store.dispose());

    test('과거 timestamp의 tick은 가격/거래량 모두 기각된다', () {
      store.applyBatch([tick('000001', price: 1100, ts: 100, volume: 10)]);
      expect(store.quoteAt(0).price, 1100);

      // 지연 도착한 과거 tick - 가격도 거래량도 과거값이므로 통째로 버려야 한다.
      store.applyBatch([tick('000001', price: 900, ts: 50, volume: 5)]);
      expect(store.quoteAt(0).price, 1100, reason: '가격이 과거로 되돌아가면 안 됨');
      expect(store.quoteAt(0).dayVolume, 10, reason: '거래량도 되돌아가면 안 됨');
      expect(store.stats.rejectedStale, 1);
    });

    test('같은 timestamp의 재적용도 기각된다 (멱등)', () {
      store.applyBatch([tick('000001', price: 1100, ts: 100, volume: 10)]);
      store.applyBatch([tick('000001', price: 1200, ts: 100, volume: 20)]);
      expect(store.quoteAt(0).price, 1100);
      expect(store.stats.rejectedStale, 1);
    });

    test('더 새로운 tick은 정상 반영된다', () {
      store.applyBatch([tick('000001', price: 1100, ts: 100, volume: 10)]);
      store.applyBatch([tick('000001', price: 1200, ts: 150, volume: 30)]);
      expect(store.quoteAt(0).price, 1200);
      expect(store.quoteAt(0).dayVolume, 30);
    });

    test('값 불변 tick은 통지 없이 timestamp만 전진한다', () {
      store.applyBatch([tick('000001', price: 1100, ts: 100, volume: 10)]);
      var notifications = 0;
      store.quoteListenable(0).addListener(() => notifications++);

      // 가격/거래량/상태가 모두 동일한 tick (clamp 고착 등) -> 통지 없음.
      store.applyBatch([tick('000001', price: 1100, ts: 200, volume: 10)]);
      expect(notifications, 0);
      expect(store.stats.unchanged, 1);

      // 그러나 timestamp는 전진했으므로, 그 사이(ts 150)의 지연 tick은 기각된다.
      store.applyBatch([tick('000001', price: 999, ts: 150, volume: 5)]);
      expect(store.quoteAt(0).price, 1100);
      expect(store.stats.rejectedStale, 1);
    });

    test('다른 종목에는 영향이 없다', () {
      store.applyBatch([tick('000001', price: 1100, ts: 100, volume: 10)]);
      expect(store.quoteAt(1).price, 2000);
      expect(store.quoteAt(1).state, TradingState.unknown);
    });
  });

  group('QuoteStore 3단 거래 상태', () {
    late QuoteStore store;

    setUp(() {
      store = QuoteStore();
      store.load([snapshotEntry('000001', price: 1000)]);
    });

    tearDown(() => store.dispose());

    test('스냅샷 직후는 unknown - active로 간주하지 않는다', () {
      expect(store.quoteAt(0).state, TradingState.unknown);
      expect(store.quoteAt(0).timestampMs, -1);
    });

    test('첫 tick으로 active/halted가 판정된다', () {
      store.applyBatch([
        tick('000001', price: 1000, ts: 100, status: QuoteStatus.halted),
      ]);
      expect(store.quoteAt(0).state, TradingState.halted);
    });

    test('halt 해제는 이후의 active tick으로만 관측된다', () {
      store.applyBatch([
        tick('000001', price: 1000, ts: 100, status: QuoteStatus.halted),
      ]);
      store.applyBatch([tick('000001', price: 1010, ts: 200, volume: 1)]);
      expect(store.quoteAt(0).state, TradingState.active);
      expect(store.quoteAt(0).price, 1010);
    });

    test('정지 직전에 생성된 지연 active tick은 halt 상태를 되돌리지 못한다', () {
      // halted tick의 timestamp(현재 시각)가 지연 tick(과거 시각)보다 항상 크므로,
      // 역순 기각 규칙이 상태 정합성도 함께 보호한다.
      store.applyBatch([
        tick('000001', price: 1000, ts: 100, status: QuoteStatus.halted),
      ]);
      store.applyBatch([tick('000001', price: 1050, ts: 60, volume: 3)]);
      expect(store.quoteAt(0).state, TradingState.halted);
      expect(store.quoteAt(0).price, 1000);
    });

    test('halted 반복 tick(완전 동일 값)은 통지를 만들지 않는다', () {
      store.applyBatch([
        tick('000001', price: 1000, ts: 100, status: QuoteStatus.halted),
      ]);
      var notifications = 0;
      store.quoteListenable(0).addListener(() => notifications++);
      store.applyBatch([
        tick('000001', price: 1000, ts: 200, status: QuoteStatus.halted),
        // 다음 배치의 반복 tick
      ]);
      store.applyBatch([
        tick('000001', price: 1000, ts: 300, status: QuoteStatus.halted),
      ]);
      expect(notifications, 0);
      expect(store.stats.unchanged, 2);
    });
  });
}

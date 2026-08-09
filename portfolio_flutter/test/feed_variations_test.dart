import 'package:flutter_test/flutter_test.dart';
import 'package:jc_ticker/data/market_repository.dart';
import 'package:jc_ticker/domain/quote.dart';
import 'package:jc_ticker/feed/market_feed.dart';
import 'package:jc_ticker/state/quote_store.dart';

/// feed 파라미터를 바꿔도 상태 계층의 불변식이 유지되는지 검증한다.
///
/// 기본값은 2,000종목 / 60Hz / 배치당 최대 250건이지만, 운영 환경이
/// `transientErrorProbability`를 올릴 수 있다고 명시했고 파라미터를 바꾼 변형
/// 질문도 예고했다. 그래서 "기본값에서만 맞는 구현"이 되지 않았는지를 코드로
/// 확인한다 (DESIGN.md §10).
///
/// 검증하는 불변식은 부하 조건과 무관하게 항상 참이어야 하는 것들이다:
/// 1. 표시 가격은 과거로 되돌아가지 않는다 (종목별 timestamp 단조)
/// 2. 증분 시가총액 == 전량 재합산
/// 3. 증분 Top-20 == 브루트포스 전체 정렬 (등락률 desc, 코드 asc)
/// 4. 에러가 실려도 구독이 살아 다음 배치가 계속 반영된다
class _Variation {
  const _Variation(this.name, this.feed, {this.batches = 60});

  final String name;
  final MarketFeed Function() feed;
  final int batches;
}

void main() {
  final variations = <_Variation>[
    _Variation('기본값', MarketFeed.new),
    _Variation('소규모 유니버스 (50종목)', () => MarketFeed(symbolCount: 50)),
    _Variation(
      '대규모 유니버스 (5,000종목)',
      () => MarketFeed(symbolCount: 5000),
      batches: 30,
    ),
    _Variation('최소 배치 (배치당 1건)', () => MarketFeed(updatesPerBatch: 1)),
    _Variation(
      '지연 tick 25배 (p=0.2)',
      () => MarketFeed(lateTickProbability: 0.2),
    ),
    _Variation('정지 25배 (p=0.05)', () => MarketFeed(haltProbability: 0.05)),
    _Variation(
      '에러 다발 (p=0.3)',
      () => MarketFeed(transientErrorProbability: 0.3),
    ),
    _Variation('다른 seed', () => MarketFeed(seed: 1234567)),
    _Variation('배치 주기 240Hz', () => MarketFeed(batchesPerSecond: 240)),
  ];

  for (final v in variations) {
    test('불변식 유지: ${v.name}', () async {
      final feed = v.feed();
      final store = QuoteStore();
      final repository = MarketRepository(feed: feed, store: store);
      repository.attach();

      // 종목별 통지 시각이 되돌아가지 않는지 감시한다 (가격 역행의 직접 관측).
      final seenTs = List<int>.filled(store.length, -1);
      for (var i = 0; i < store.length; i++) {
        final index = i;
        store.quoteListenable(index).addListener(() {
          final ts = store.quoteAt(index).timestampMs;
          expect(
            ts,
            greaterThan(seenTs[index]),
            reason: '${v.name}: 종목 $index의 timestamp가 역행',
          );
          seenTs[index] = ts;
        });
      }

      feed.pump(v.batches);
      await pumpEventQueue();

      // 1) 가격 역행 없음 - 위 리스너가 감시했고, 최종 상태도 확인한다.
      for (var i = 0; i < store.length; i++) {
        final q = store.quoteAt(i);
        if (q.state != TradingState.unknown) {
          expect(q.timestampMs, greaterThanOrEqualTo(0));
        }
      }

      // 2) 증분 시가총액 == 전량 재합산
      var bruteCap = BigInt.zero;
      for (var i = 0; i < store.length; i++) {
        bruteCap += BigInt.from(
          store.quoteAt(i).price.round() * store.symbolAt(i).listedShares,
        );
      }
      expect(
        store.marketCapSum.value,
        bruteCap,
        reason: '${v.name}: 증분 시총이 전량 재합산과 불일치',
      );

      // 3) 증분 Top-20 == 브루트포스 전체 정렬
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
        reason: '${v.name}: 증분 순위가 전체 정렬과 불일치',
      );

      // 4) 구독 생존 - 추가 배치가 계속 반영된다.
      final appliedBefore = store.stats.applied;
      feed.pump(20);
      await pumpEventQueue();
      expect(
        store.stats.applied,
        greaterThan(appliedBefore),
        reason: '${v.name}: 추가 배치가 반영되지 않음 (구독이 끊겼을 가능성)',
      );

      repository.dispose();
      store.dispose();
      feed.dispose();
    });
  }

  test('지연 tick 확률을 올리면 기각 건수가 실제로 늘어난다', () async {
    Future<int> rejectedWith(double p) async {
      final feed = MarketFeed(lateTickProbability: p);
      final store = QuoteStore();
      MarketRepository(feed: feed, store: store).attach();
      feed.pump(120);
      await pumpEventQueue();
      final n = store.stats.rejectedStale;
      store.dispose();
      feed.dispose();
      return n;
    }

    // 기각 장치가 파라미터에 반응하는지 = 장치가 실제로 동작 중인지의 반증 테스트.
    expect(await rejectedWith(0.2), greaterThan(await rejectedWith(0.008)));
  });
}

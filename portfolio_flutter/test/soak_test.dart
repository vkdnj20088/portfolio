import 'package:flutter_test/flutter_test.dart';
import 'package:jc_ticker/data/market_repository.dart';
import 'package:jc_ticker/feed/market_feed.dart';
import 'package:jc_ticker/state/quote_store.dart';
import 'package:jc_ticker/ui/sparkline.dart';

/// 장시간(soak) 안정성 - 벤치 시나리오(~20초 분량)보다 훨씬 긴 구간에서도
/// 자료구조가 상수 크기를 유지하고 회계가 맞아떨어지는지 검증한다.
///
/// 12,000배치 = 60Hz 기준 200초(3분 20초) 분량, 약 149만 tick(실측 1,486,361).
void main() {
  test('12,000배치(200초 분량) 주입: tick 회계 일치와 값 불변 tick의 분포 구조', () async {
    final feed = MarketFeed();
    final store = QuoteStore();
    MarketRepository(feed: feed, store: store).attach();

    // 완전 불변 tick과 "가격만 고착(거래량은 변동)" tick을 구분해 세어,
    // clamp 고착이 실제로 어느 버킷에 쌓이는지 관측한다.
    var received = 0;
    var priceStuckVolMoved = 0;
    final lastPrice = <String, double>{};
    final lastVol = <String, int>{};
    final lastTs = <String, int>{};
    feed.ticks.listen((batch) {
      for (final t in batch) {
        received++;
        if (t.timestampMs <= (lastTs[t.code] ?? -1)) continue;
        lastTs[t.code] = t.timestampMs;
        if (t.price == lastPrice[t.code] && t.dayVolume != lastVol[t.code]) {
          priceStuckVolMoved++;
        }
        lastPrice[t.code] = t.price;
        lastVol[t.code] = t.dayVolume;
      }
    });

    feed.pump(6000);
    await pumpEventQueue();
    final unchangedFirstHalf = store.stats.unchanged;

    feed.pump(6000);
    await pumpEventQueue();
    final unchangedSecondHalf = store.stats.unchanged - unchangedFirstHalf;

    // 1) 회계 일치: 받은 tick은 반영/기각/불변 셋 중 정확히 하나로 계산된다.
    //    (하나라도 새면 조용한 유실 - 가장 발견하기 어려운 종류의 버그다)
    expect(
      store.stats.applied + store.stats.rejectedStale + store.stats.unchanged,
      received,
      reason: 'tick 회계 불일치 (유실 또는 이중 계산)',
    );
    expect(received, greaterThan(1000000), reason: '주입량 자체가 예상보다 적음');

    // 2) clamp 고착의 실제 모습 (PERF.md §5의 실측 근거).
    //    처음 예상은 "완전 불변 tick이 장시간일수록 늘어난다"였으나 실측은 반대다:
    //    가격이 고착되어도 거래량은 계속 변하므로, 고착은 완전 불변(약 0.07%)이
    //    아니라 "가격 고착 + 거래량 변동" 버킷(전체의 ~20%)에 쌓인다. 완전 불변은
    //    halted 반복 + 우연의 일치뿐이라 시간이 지나도 일정 비율에 머문다.
    //    이 테스트는 그 구조를 고정한다 - 어느 쪽 단언이 깨져도 부하 모델이
    //    바뀌었다는 신호이고, 필드별 변경 플래그 설계의 근거를 다시 봐야 한다.
    expect(
      priceStuckVolMoved,
      greaterThan(received ~/ 10),
      reason: '가격 고착 + 거래량 변동이 지배적 버킷(>10%)이어야 함',
    );
    expect(
      store.stats.unchanged,
      lessThan(received ~/ 100),
      reason: '완전 불변은 소수(<1%)여야 함',
    );
    expect(
      unchangedSecondHalf,
      lessThan(unchangedFirstHalf * 3),
      reason: '완전 불변 tick은 누적 폭증 없이 일정 비율이어야 함',
    );

    // 3) 자료구조 상수성: 종목 수 기반 구조는 성장하지 않는다.
    expect(store.length, feed.symbolCount);
    expect(store.top20.value.length, 20);

    // ignore: avoid_print
    print(
      'SOAK batches=12000 ticks=$received stats=${store.stats} '
      'price_stuck_vol_moved=$priceStuckVolMoved '
      'unchanged_1st_half=$unchangedFirstHalf unchanged_2nd_half=$unchangedSecondHalf',
    );

    store.dispose();
    feed.dispose();
  });

  test('PriceRing은 용량을 넘는 추가에서도 고정 크기를 유지한다 (스파크라인 무한 성장 방지)', () {
    final ring = PriceRing(180);
    for (var i = 0; i < 100000; i++) {
      ring.add(i.toDouble());
    }
    expect(ring.length, 180, reason: '용량 초과 추가 후에도 길이는 capacity 고정');
    // 내용은 마지막 180개: 99820..99999 순서 유지.
    expect(ring[0], 99820.0);
    expect(ring[179], 99999.0);
  });
}

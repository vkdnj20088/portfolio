import 'package:flutter_test/flutter_test.dart';
import 'package:jc_ticker/data/market_repository.dart';
import 'package:jc_ticker/feed/market_feed.dart';
import 'package:jc_ticker/state/quote_store.dart';

/// 일시적 스트림 에러 생존 회귀 테스트 .
///
/// transientErrorProbability를 0.1로 켜고
/// "에러가 와도 구독이 유지되고 다음 배치로 복구되는지"를 확인한다.
void main() {
  test('에러가 섞여도 구독이 살아남아 배치가 계속 반영된다', () async {
    final feed = MarketFeed(transientErrorProbability: 0.1, seed: 7);
    final store = QuoteStore();
    var fakeNow = 0;
    final repository = MarketRepository(
      feed: feed,
      store: store,
      nowMs: () => fakeNow,
    );
    repository.attach();

    feed.pump(100);
    await pumpEventQueue();

    expect(
      repository.health.value.errorCount,
      greaterThan(0),
      reason: 'p=0.1로 100배치면 에러가 발생했어야 함',
    );
    expect(store.stats.applied, greaterThan(0));

    // 에러 이후에도 적용이 계속되는지: 추가 배치가 상태를 계속 갱신해야 한다.
    final appliedBefore = store.stats.applied;
    fakeNow = 500;
    feed.pump(50);
    await pumpEventQueue();
    expect(
      store.stats.applied,
      greaterThan(appliedBefore),
      reason: '에러 후에도 구독이 살아 있어야 함 (재구독 없이)',
    );

    repository.dispose();
    store.dispose();
    feed.dispose();
  });

  test('degraded 상태는 조용한 구간 이후 배치에서 healthy로 복구된다', () async {
    final feed = MarketFeed(transientErrorProbability: 0.1, seed: 7);
    final store = QuoteStore();
    var fakeNow = 0;
    final repository = MarketRepository(
      feed: feed,
      store: store,
      nowMs: () => fakeNow,
      recoveryQuietMs: 1000,
    );
    repository.attach();

    // 에러가 날 때까지 pump.
    while (repository.health.value.errorCount == 0) {
      feed.pump(10);
      await pumpEventQueue();
    }
    expect(repository.health.value.isDegraded, isTrue);

    // 마지막 에러로부터 1초 이상 경과 후 정상 배치가 오면 healthy로 복귀.
    // (에러가 또 나면 lastError가 갱신되므로 시간을 크게 벌리며 반복)
    var recovered = false;
    for (var attempt = 0; attempt < 50 && !recovered; attempt++) {
      fakeNow += 2000;
      feed.pump(1);
      await pumpEventQueue();
      recovered = !repository.health.value.isDegraded;
    }
    expect(recovered, isTrue, reason: '조용한 구간 후 배치로 복구되어야 함');
    expect(
      repository.health.value.errorCount,
      greaterThan(0),
      reason: '누적 에러 횟수는 보존된다',
    );

    repository.dispose();
    store.dispose();
    feed.dispose();
  });
}

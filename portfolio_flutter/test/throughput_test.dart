import 'package:flutter_test/flutter_test.dart';
import 'package:jc_ticker/feed/market_feed.dart';
import 'package:jc_ticker/feed/market_models.dart';
import 'package:jc_ticker/state/quote_store.dart';

/// feed 부하 상한(초당 15,000건)에서 상태 계층의 여력을 재는 처리량 테스트.
///
/// **주의 - 이 부하는 seed가 만든 수열이 아니라 합성(synthetic) 부하다.**
/// seed의 배치 크기는 `1 + Random.nextInt(250)`(1~250 균등)이라 평균 유입이
/// ~7,500건/s이고, 지속 15,000건/s 구간은 seed를 수정하지 않는 한 나오지 않는다.
/// 그래서 여기서는 상한값인 250건짜리 배치를 직접 만들어 60Hz x 250건 = 15,000건/s를
/// 10초 분량(600배치) 주입한다. `lib/feed/`는 데이터 소스 역할만 유지한다.
/// 진짜 seed 수열로 15,060건/s를 재현하는 프레임 레벨 측정은 별도로 있다
/// (integration_test의 `idle15k` 구간, PERF.md §6).
///
/// 이 테스트가 지키는 것은 "빠름"이 아니라 **여력의 자릿수**다. 회귀 가드는
/// 프레임 예산(16.7ms)의 1/4을 상한으로 두어, 배치 하나 처리에 그 이상 쓰기
/// 시작하면 실패한다. debug(JIT) 실행이므로 실제 profile 값은 이보다 낮다.
///
/// 두 번째 테스트는 상한 너머의 스케일 스윕이다 - "여유롭다"는 "언제 깨지는가"를
/// 알 때만 의미가 있으므로, 프레임당 tick을 250~4,000건(15k~240k/s 상당)으로
/// 올리며 배치당 비용이 프레임 예산에 닿는 지점을 찾는다 (PERF.md §6-1).
List<List<QuoteTick>> synthesizeBatches({
  required List<QuoteSnapshotEntry> snapshot,
  required List<String> codes,
  required int batchCount,
  required int ticksPerBatch,
}) {
  final batches = <List<QuoteTick>>[];
  for (var b = 0; b < batchCount; b++) {
    final batch = <QuoteTick>[];
    final n = ticksPerBatch.clamp(1, codes.length);
    for (var k = 0; k < n; k++) {
      final i = (b * 7919 + k * 31) % codes.length;
      final base = snapshot[i].price;
      batch.add(
        QuoteTick(
          code: codes[i],
          price: base * (1 + ((b + k) % 7 - 3) * 0.001),
          dayVolume: 1000 + b * 3 + k,
          timestampMs: b + 1,
        ),
      );
    }
    batches.add(batch);
  }
  return batches;
}

double measureUsPerBatch(
  List<QuoteSnapshotEntry> snapshot,
  List<List<QuoteTick>> batches,
) {
  final store = QuoteStore();
  store.load(snapshot);
  for (var i = 0; i < 20; i++) {
    store.quoteListenable(i).addListener(() {});
  }
  final sw = Stopwatch()..start();
  for (final batch in batches) {
    store.applyBatch(batch);
  }
  sw.stop();
  store.dispose();
  return sw.elapsedMicroseconds / batches.length;
}

void main() {
  test('상한 부하 15,000 tick/s 지속 주입 시 배치당 적용 비용 (수치 출력)', () {
    const batchCount = 600; // 60Hz 기준 10초 분량
    const ticksPerBatch = 250; // seed의 updatesPerBatch 상한
    const budgetUsPerBatch = 16667 / 4;

    final feed = MarketFeed();
    final snapshot = feed.initialSnapshot();
    final codes = [for (final e in snapshot) e.info.code];

    // 합성 배치: 한 배치 안에 같은 종목이 두 번 오지 않도록 stride로 고르고,
    // timestamp는 배치마다 전진시켜 정합성 검증(단조 강제)을 정상 통과시킨다.
    final batches = synthesizeBatches(
      snapshot: snapshot,
      codes: codes,
      batchCount: batchCount,
      ticksPerBatch: ticksPerBatch,
    );

    final store = QuoteStore();
    store.load(snapshot);
    // 화면에 실제로 떠 있는 행 수만큼 리스너를 붙인다 (뷰포트 ~15행).
    for (var i = 0; i < 20; i++) {
      store.quoteListenable(i).addListener(() {});
    }

    final sw = Stopwatch()..start();
    for (final batch in batches) {
      store.applyBatch(batch);
    }
    sw.stop();

    final totalTicks = batchCount * ticksPerBatch;
    final usPerBatch = sw.elapsedMicroseconds / batchCount;
    final nsPerTick = sw.elapsedMicroseconds * 1000 / totalTicks;
    // 주입한 10초 분량을 처리하는 데 쓴 시간 = 한 코어 점유율.
    final cpuPct = sw.elapsedMicroseconds / (batchCount / 60 * 1000000) * 100;

    // ignore: avoid_print
    print(
      'THROUGHPUT_15K ticks=$totalTicks batches=$batchCount '
      'total_ms=${sw.elapsedMilliseconds} '
      'us_per_batch=${usPerBatch.toStringAsFixed(1)} '
      'ns_per_tick=${nsPerTick.toStringAsFixed(0)} '
      'cpu_pct_of_one_core=${cpuPct.toStringAsFixed(2)} '
      'stats=${store.stats}',
    );

    expect(
      usPerBatch,
      lessThan(budgetUsPerBatch),
      reason: '상한 부하에서 배치당 적용 비용이 프레임 예산의 1/4을 넘으면 설계 회귀',
    );
    expect(store.stats.applied, totalTicks - store.stats.unchanged);

    store.dispose();
    feed.dispose();
  });

  test('포화점 스윕: 유입을 늘리며 배치당 비용이 예산에 닿는 지점 (수치 출력)', () {
    final feed = MarketFeed();
    final snapshot = feed.initialSnapshot();
    final codes = [for (final e in snapshot) e.info.code];

    // 프레임당 tick 수. 250 = feed 상한(15k/s), 2000 = 전 종목이 매 프레임 갱신
    // (120k/s 상당, 이 유니버스에서 물리적으로 가능한 최대 유입).
    const scales = [125, 250, 500, 1000, 2000];
    final results = <int, double>{};
    for (final ticksPerBatch in scales) {
      final batches = synthesizeBatches(
        snapshot: snapshot,
        codes: codes,
        batchCount: 300,
        ticksPerBatch: ticksPerBatch,
      );
      // 워밍업 1회 후 측정 1회 (JIT 편차 완화).
      measureUsPerBatch(snapshot, batches);
      results[ticksPerBatch] = measureUsPerBatch(snapshot, batches);
    }

    final sweepLine = results.entries
        .map(
          (e) =>
              '${e.key}t/f(${e.key * 60 ~/ 1000}k/s)=${e.value.toStringAsFixed(0)}us',
        )
        .join(' ');
    // ignore: avoid_print
    print('SCALE_SWEEP $sweepLine');

    // feed 상한(250건/프레임)에서는 예산의 1/4 안이어야 하고, 물리적 최대
    // 유입(2,000건/프레임)에서도 프레임 예산 자체는 넘지 않아야 한다.
    expect(results[250], lessThan(16667 / 4));
    expect(
      results[2000],
      lessThan(16667),
      reason: '전 종목 매 프레임 갱신에서도 적용 비용이 프레임 예산을 넘으면 안 됨',
    );

    feed.dispose();
  });
}

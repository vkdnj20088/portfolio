import 'dart:collection';

import 'package:flutter_test/flutter_test.dart';
import 'package:jc_ticker/feed/market_feed.dart';
import 'package:jc_ticker/feed/market_models.dart';
import 'package:jc_ticker/state/quote_store.dart';
import 'package:jc_ticker/state/rank_index.dart';

/// 순위 유지 비용의 재현 하네스 - PERF.md §2(지배 항목)와 §6-3(tiebreak 전후)의 출처.
///
/// 이 두 수치는 원래 저장소 밖 일회성 하네스에서 재던 것이라 아무도 재현할 수 없었다.
/// "적용 비용의 대부분이 순위 유지"라는 문장이 §6-3·§6-4의 판단(어디를 고칠지, 무엇을
/// 기각할지)을 통째로 지탱하는데 그 근거를 다시 잴 수 없다면 문서가 아니라 주장이다.
/// 그래서 재현 가능한 형태로 옮겼다.
///
/// 무엇을 어떻게 재는가:
///  1. **전체**: 실제 [QuoteStore.applyBatch]로 같은 600배치를 흘려 총 시간을 잰다.
///  2. **순위 유지**: 그 배치가 [RankIndex]에 실제로 일으키는 갱신열을 뽑아, 실제
///     [RankIndex]에 그대로 먹여 시간을 잰다. 갱신열 추출은 스토어가 순위를 갱신하는
///     조건 둘(**timestamp 단조 통과** + **가격 변화**)만 그대로 옮긴 것이다.
///  3. 두 값의 비가 지배 항목의 비중이다. 나머지 항목(통지·할당·시총·조회)은 따로
///     쪼개지 않는다 - 항목별 6분할은 각 항목을 재구현해야 해서, 재현성은 얻어도
///     "재구현이 원본과 같은가"라는 더 나쁜 불확실성을 들여온다.
///
/// §6-3(tiebreak)은 같은 갱신열을 **문자열 tiebreak 구현**(이 파일에 원형 복제)에도
/// 먹여 대조한다. 비교자 외에는 현 구현과 같은 구조라, 차이는 비교자에서만 온다.
///
/// debug(JIT)로 도는 `flutter test` 값이므로 **절대값이 아니라 비율과 상대 비교**가
/// 의미의 중심이다(프레임 수치는 integration_test/profile 이 기준).
void main() {
  test('순위 유지가 적용 비용에서 차지하는 비중 + tiebreak 전후 (수치 출력)', () async {
    final feed = MarketFeed();
    final snapshot = feed.initialSnapshot();
    final captured = <List<QuoteTick>>[];
    final sub = feed.ticks.listen(captured.add);
    feed.pump(600); // 10초 분량
    await pumpEventQueue();
    await sub.cancel();
    expect(captured.length, 600);

    // JIT 언어라 첫 실행에는 컴파일 비용이 섞인다. 워밍업 1회 뒤 4회 중 **최소값**을
    // 쓴다 - 최소값은 "다른 일이 끼어들지 않은 실행"에 가장 가깝다. 실행마다 상태를
    // 새로 만드는 이유: 스토어는 timestamp 단조 강제라 같은 배치를 두 번 먹이면
    // 전부 기각되고, RankIndex 도 두 번째 갱신열은 값이 이미 같아 no-op 이 된다.
    int minMicros(int iterations, void Function() body) {
      var best = -1;
      for (var i = 0; i <= iterations; i++) {
        final sw = Stopwatch()..start();
        body();
        sw.stop();
        if (i == 0) continue; // 워밍업
        if (best < 0 || sw.elapsedMicroseconds < best) {
          best = sw.elapsedMicroseconds;
        }
      }
      return best;
    }

    // ── 1) 전체 적용 비용 (실제 스토어) ────────────────────────────────
    QuoteStore? lastStore;
    final applyMicros = minMicros(4, () {
      lastStore?.dispose();
      final s = QuoteStore()..load(snapshot);
      lastStore = s;
      // load 는 측정에서 빼야 하므로 stopwatch 안에 있는 것은 배치 적용뿐이어야 하지만,
      // 위 생성/load 가 같은 body 안에 있다. 그래서 아래에서 load 비용을 따로 재 빼낸다.
      for (final batch in captured) {
        s.applyBatch(batch);
      }
    });
    final loadMicros = minMicros(4, () {
      QuoteStore().load(snapshot);
    });
    final applyOnlyMicros = applyMicros - loadMicros;

    // ── 2) 같은 배치가 일으키는 실제 갱신열 추출 ───────────────────────
    // 스토어가 _rank.update 를 부르는 조건을 그대로 옮긴다: timestamp 가 전진했고,
    // 가격이 바뀐 tick 만. 등락률 식도 스토어와 같다(previousClose 는 불변).
    final codes = snapshot.map((e) => e.info.code).toList();
    final indexOf = {for (var i = 0; i < codes.length; i++) codes[i]: i};
    // 스냅샷에는 timestamp 가 없다 - 스토어도 load() 에서 -1 로 시작한다(첫 tick 은
    // 무조건 통과). 같은 값으로 맞춘다.
    final lastTs = List<int>.filled(codes.length, -1);
    final price = List<double>.filled(codes.length, 0);
    final prevClose = List<double>.filled(codes.length, 0);
    for (var i = 0; i < snapshot.length; i++) {
      price[i] = snapshot[i].price;
      prevClose[i] = snapshot[i].previousClose;
    }
    final updIndex = <int>[];
    final updRate = <double>[];
    for (final batch in captured) {
      for (final t in batch) {
        final i = indexOf[t.code];
        if (i == null) continue;
        if (t.timestampMs <= lastTs[i]) continue;
        lastTs[i] = t.timestampMs;
        if (t.price == price[i]) continue;
        price[i] = t.price;
        updIndex.add(i);
        updRate.add(
          prevClose[i] == 0
              ? 0.0
              : (t.price - prevClose[i]) / prevClose[i] * 100,
        );
      }
    }
    expect(updIndex, isNotEmpty);

    // ── 3) 현 구현(정수 tiebreak)에 같은 갱신열 ────────────────────────
    RankIndex? lastRank;
    final rankMicros = minMicros(4, () {
      final r = RankIndex(codes);
      lastRank = r;
      for (var k = 0; k < updIndex.length; k++) {
        r.update(updIndex[k], updRate[k]);
      }
    });

    // ── 4) 문자열 tiebreak(변경 전)에 같은 갱신열 ──────────────────────
    _StringTiebreakRankIndex? lastLegacy;
    final legacyMicros = minMicros(4, () {
      final l = _StringTiebreakRankIndex(codes);
      lastLegacy = l;
      for (var k = 0; k < updIndex.length; k++) {
        l.update(updIndex[k], updRate[k]);
      }
    });

    final share = rankMicros / applyOnlyMicros;
    final nsNow = rankMicros * 1000 / updIndex.length;
    final nsLegacy = legacyMicros * 1000 / updIndex.length;

    // ignore: avoid_print
    print(
      'RANK_COST batches=${captured.length} updates=${updIndex.length} '
      'apply_us=$applyOnlyMicros rank_us=$rankMicros '
      'rank_share_pct=${(share * 100).toStringAsFixed(1)} '
      'int_tiebreak_ns=${nsNow.toStringAsFixed(0)} '
      'string_tiebreak_ns=${nsLegacy.toStringAsFixed(0)} '
      'tiebreak_delta_pct=${((nsNow - nsLegacy) / nsLegacy * 100).toStringAsFixed(1)}',
    );

    // 두 구현이 **같은 순서**를 만드는지 확인한다 - 이게 깨지면 위 비교는 무의미하다
    // (rank_index_test.dart 가 fuzz 로 보는 등가성을, 여기서도 실제 갱신열로 한 번 더).
    expect(lastRank!.top(20), lastLegacy!.top(20));

    // 회귀 가드: 순위 유지가 적용 비용의 최대 항목이라는 §2의 전제. 나머지 전부를
    // 합친 것과 견줄 크기라는 뜻으로 1/3 을 하한으로 둔다 - 이 아래로 내려가면
    // §6-3·§6-4 의 "손잡이는 사실상 하나" 판단을 다시 해야 한다.
    expect(
      share,
      greaterThan(1 / 3),
      reason: '순위 유지가 최대 항목이 아니게 되면 PERF.md §2/§6 의 판단 근거가 바뀐다',
    );

    lastStore?.dispose();
    feed.dispose();
  });
}

/// 변경 **전** 구현(문자열 tiebreak)의 원형 복제. §6-3 대조용이며 앱은 쓰지 않는다.
/// 비교자만 다르고 자료구조/갱신 절차는 현 구현과 같다.
class _StringTiebreakRankIndex {
  _StringTiebreakRankIndex(this._codes)
    : _rates = List<double>.filled(_codes.length, 0) {
    _tree = SplayTreeSet<int>(_compare);
    for (var i = 0; i < _codes.length; i++) {
      _tree.add(i);
    }
  }

  final List<String> _codes;
  final List<double> _rates;
  late final SplayTreeSet<int> _tree;

  int _compare(int a, int b) {
    if (a == b) return 0;
    final c = _rates[b].compareTo(_rates[a]); // 등락률 내림차순
    if (c != 0) return c;
    return _codes[a].compareTo(_codes[b]); // 문자열 tiebreak
  }

  void update(int index, double newRate) {
    if (_rates[index] == newRate) return;
    _tree.remove(index);
    _rates[index] = newRate;
    _tree.add(index);
  }

  List<int> top(int k) {
    final out = <int>[];
    for (final i in _tree) {
      out.add(i);
      if (out.length >= k) break;
    }
    return out;
  }
}

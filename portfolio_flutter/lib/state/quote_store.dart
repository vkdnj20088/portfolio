import 'dart:async';

import 'package:flutter/foundation.dart';

import '../domain/quote.dart';
import '../feed/market_models.dart';
import 'gated_notifier.dart';
import 'rank_index.dart';

/// applyBatch가 tick을 어떻게 처리했는지의 누적 통계 (테스트/디버그/PERF 측정용).
class ApplyStats {
  /// 값이 실제로 바뀌어 상태에 반영된 tick 수.
  int applied = 0;

  /// timestampMs가 이미 반영된 값보다 과거라 기각된 tick 수 (지연/역순 tick).
  int rejectedStale = 0;

  /// 가격/거래량/상태 모두 동일해 통지 없이 timestamp만 전진시킨 tick 수
  /// (clamp 도달/steps=0로 인한 "값 불변 tick", halted 반복 tick).
  int unchanged = 0;

  @override
  String toString() =>
      'ApplyStats(applied: $applied, rejectedStale: $rejectedStale, '
      'unchanged: $unchanged)';
}

/// 앱의 단일 진실 공급원(single source of truth).
///
/// 책임 (DESIGN.md §2):
/// - **정합성**: 종목별 timestampMs 단조 증가 강제 - 지연/역순 tick은 tick 단위로
///   기각한다 (가격뿐 아니라 거래량 역행도 함께 차단).
/// - **3단 상태**: 스냅샷 직후는 unknown, 이후 tick의 status로 active/halted 판정.
/// - **증분 집계**: 시가총액 합계는 BigInt 델타 누적(오차 0), 등락률 순위는
///   [RankIndex]로 O(log n) 유지 - 매 tick 전체 순회/재정렬 없음.
/// - **통지 제어**: 값은 항상 즉시 반영하되, 통지는 종목별 [GatedNotifier]로
///   범위 제한([restrictNotifications])/주기 flush([notifyIntervalMs])가 가능하다.
///
/// 통지 정책: 기본([notifyIntervalMs] == 0)은 배치 도착 즉시 통지다. 배치는 60Hz로
/// 오고 Flutter는 어차피 프레임당 1회만 build하므로, 즉시 통지 = 사실상 프레임 정렬
/// coalescing이며 신선도(<=200ms 요구)에 가장 유리하다. 근거 실측은 PERF.md 참조.
class QuoteStore {
  QuoteStore({this.notifyIntervalMs = 0});

  /// 0 = 배치 도착 즉시 통지(기본). N>0 = N ms 주기로 모아 통지 (벤치 스윕용).
  final int notifyIntervalMs;

  final List<SymbolInfo> _symbols = [];
  final Map<String, int> _indexOf = {};
  final List<GatedNotifier<Quote>> _quotes = [];
  final List<int> _lastTs = [];
  final List<double> _openPrice = [];
  final List<double> _sessionHigh = [];
  final List<double> _sessionLow = [];
  RankIndex? _rank;

  BigInt _mcapSumValue = BigInt.zero;
  final GatedNotifier<BigInt> _mcapSum = GatedNotifier<BigInt>(BigInt.zero);
  final GatedNotifier<List<int>> _top20 = GatedNotifier<List<int>>(const []);

  Set<int>? _notifyScope;
  bool _notificationsPaused = false;
  Timer? _flushTimer;
  bool _disposed = false;

  final ApplyStats stats = ApplyStats();

  int _rowNotificationCount = 0;

  /// 리스너가 붙은 행(=화면에 mount된 행)에 실제로 전달된 통지의 누적 수.
  /// 수신 tick 수와 나란히 놓으면 "유입 대비 rebuild 유발"의 격차가 보인다 (계측 표시용).
  int get rowNotificationCount => _rowNotificationCount;

  /// 스토어가 처리한 tick 누적 수 (반영 + 기각 + 값 불변).
  int get processedTickCount =>
      stats.applied + stats.rejectedStale + stats.unchanged;

  // ---- 조회 API ----

  int get length => _symbols.length;

  List<SymbolInfo> get symbols => List.unmodifiable(_symbols);

  SymbolInfo symbolAt(int index) => _symbols[index];

  int? indexOfCode(String code) => _indexOf[code];

  /// 종목 하나의 시세 스트림 - 행 위젯이 자기 종목에만 구독하는 단위.
  ValueListenable<Quote> quoteListenable(int index) => _quotes[index];

  Quote quoteAt(int index) => _quotes[index].value;

  /// 시가 성격 값 (구독 시작 시점 스냅샷 가격 - DESIGN.md §6의 근사 정의).
  double openPriceAt(int index) => _openPrice[index];

  /// 앱 구동 이후 관측 고가/저가.
  double sessionHighAt(int index) => _sessionHigh[index];
  double sessionLowAt(int index) => _sessionLow[index];

  /// 시가총액 합계(원, BigInt 정밀). 전체 2,000종목 기준 (DESIGN.md §5).
  ValueListenable<BigInt> get marketCapSum => _mcapSum;

  /// 등락률 상위 20 종목 index - **순서가 바뀔 때만** 통지된다.
  /// (각 타일의 가격/등락률 내용은 종목별 notifier로 갱신됨)
  ValueListenable<List<int>> get top20 => _top20;

  /// 현재 통지 범위 (null = 전체). 테스트 검증용 공개.
  Set<int>? get notifyScope => _notifyScope;

  // ---- 수명주기 ----

  /// 스냅샷으로 초기 상태를 구성한다. 1회만 호출.
  ///
  /// 모든 종목은 [TradingState.unknown]으로 시작한다 - 스냅샷에는 정지 정보가
  /// 없고, 첫 tick이 오기 전까지는 정지 여부를 알 수 없기 때문 (feed 계약).
  void load(List<QuoteSnapshotEntry> snapshot) {
    assert(_symbols.isEmpty, 'QuoteStore.load는 1회만 호출해야 합니다');
    final codes = <String>[];
    var sum = BigInt.zero;
    for (var i = 0; i < snapshot.length; i++) {
      final e = snapshot[i];
      _symbols.add(e.info);
      _indexOf[e.info.code] = i;
      codes.add(e.info.code);
      _quotes.add(
        GatedNotifier<Quote>(
          Quote(
            price: e.price,
            dayVolume: e.dayVolume,
            timestampMs: -1,
            state: TradingState.unknown,
            previousClose: e.previousClose,
          ),
        ),
      );
      _lastTs.add(-1);
      _openPrice.add(e.price);
      _sessionHigh.add(e.price);
      _sessionLow.add(e.price);
      // 가격은 호가단위 반올림된 정수값이므로 정수 연산으로 정확히 합산한다.
      // 종목당 곱(최대 ~2.5e14)은 int 안전 범위지만 합계(~1.3e17)는 JS 컴파일의
      // 정밀 상한(2^53)을 넘으므로 누적만 BigInt로 한다 - web 타깃을 위해
      // DESIGN.md §10의 "web 타깃 추가" 행을 실제로 실행한 변경이다.
      sum += BigInt.from(e.price.round() * e.info.listedShares);
    }
    _mcapSumValue = sum;
    _mcapSum.update(sum, notify: false);

    final rank = RankIndex(codes);
    for (var i = 0; i < snapshot.length; i++) {
      rank.update(i, _quotes[i].value.changeRate);
    }
    _rank = rank;
    _top20.update(rank.top(20), notify: false);

    if (notifyIntervalMs > 0) {
      _flushTimer = Timer.periodic(
        Duration(milliseconds: notifyIntervalMs),
        (_) => flushDeferred(),
      );
    }
  }

  // ---- tick 소비 ----

  /// feed 배치 하나를 상태에 반영한다. seed->도메인 변환 경계는 이 함수 하나다.
  void applyBatch(List<QuoteTick> batch) {
    assert(_symbols.isNotEmpty, 'load 이전에 applyBatch를 호출할 수 없습니다');
    final immediate = notifyIntervalMs == 0;
    var mcapChanged = false;
    var rankChanged = false;

    for (final tick in batch) {
      final index = _indexOf[tick.code];
      if (index == null) continue;

      // [정합성] 지연/역순 tick 기각: 이미 더 새로운 tick을 반영했다면 이 tick의
      // 가격/거래량 모두 과거값이므로 통째로 버린다. (=로 재적용도 막아 멱등)
      if (tick.timestampMs <= _lastTs[index]) {
        stats.rejectedStale++;
        continue;
      }
      _lastTs[index] = tick.timestampMs;

      final old = _quotes[index].value;
      final newState = tick.status == QuoteStatus.halted
          ? TradingState.halted
          : TradingState.active;
      final priceChanged = tick.price != old.price;
      final volumeChanged = tick.dayVolume != old.dayVolume;
      final stateChanged = newState != old.state;

      // [값 불변 tick] 아무 값도 바뀌지 않았다면 (halted 반복, clamp 고착 등)
      // timestamp만 전진시키고 통지/집계를 모두 건너뛴다.
      if (!priceChanged && !volumeChanged && !stateChanged) {
        stats.unchanged++;
        continue;
      }

      if (priceChanged) {
        // [증분 시총] 바뀐 종목의 델타만 누적 - 전체 재합산 없음. 델타 곱은
        // int 안전 범위(최대 ~1e12)라 int로 만들고 누적만 BigInt로 한다.
        _mcapSumValue += BigInt.from(
          (tick.price.round() - old.price.round()) *
              _symbols[index].listedShares,
        );
        mcapChanged = true;
        if (tick.price > _sessionHigh[index]) _sessionHigh[index] = tick.price;
        if (tick.price < _sessionLow[index]) _sessionLow[index] = tick.price;
        // [증분 순위] 이 종목의 등락률만 O(log n)로 갱신.
        final rate = old.previousClose == 0
            ? 0.0
            : (tick.price - old.previousClose) / old.previousClose * 100;
        _rank!.update(index, rate);
        rankChanged = true;
      }

      stats.applied++;
      final next = Quote(
        price: tick.price,
        dayVolume: tick.dayVolume,
        timestampMs: tick.timestampMs,
        state: newState,
        previousClose: old.previousClose,
      );
      final canNotify =
          immediate &&
          !_notificationsPaused &&
          (_notifyScope == null || _notifyScope!.contains(index));
      if (canNotify && _quotes[index].isListened) _rowNotificationCount++;
      _quotes[index].update(next, notify: canNotify);
    }

    if (mcapChanged || rankChanged) {
      _publishAggregates(immediate: immediate);
    }
  }

  void _publishAggregates({required bool immediate}) {
    final canNotify =
        immediate && !_notificationsPaused && _notifyScope == null;
    if (_mcapSum.value != _mcapSumValue) {
      _mcapSum.update(_mcapSumValue, notify: canNotify);
    }
    // Top-20은 "순서"가 바뀐 경우에만 새 리스트를 내보낸다. 타일 내용(등락률 텍스트)은
    // 종목별 notifier가 담당하므로, 순서 불변이면 스트립 구조 rebuild가 없다.
    final newTop = _rank!.top(20);
    if (!listEquals(newTop, _top20.value)) {
      _top20.update(newTop, notify: canNotify);
    }
  }

  // ---- 통지 제어 ----

  /// 미뤄진 통지를 현재 통지 범위 안에서 모두 방출한다 (주기 flush 모드의 타이머,
  /// 통지 범위 변경 시점에 호출).
  void flushDeferred() {
    if (_disposed || _notificationsPaused) return;
    final scope = _notifyScope;
    for (var i = 0; i < _quotes.length; i++) {
      if (scope == null || scope.contains(i)) {
        // 계측은 "통지 시점에 리스너가 있었는가" 기준이므로 flush 전에 읽는다
        // (통지 콜백 안에서 리스너가 제거될 수 있다).
        final listened = _quotes[i].isListened;
        if (_quotes[i].flushIfDeferred() && listened) {
          _rowNotificationCount++;
        }
      }
    }
    if (scope == null) {
      _mcapSum.flushIfDeferred();
      _top20.flushIfDeferred();
    }
  }

  /// 통지 범위를 [allowed]로 제한한다 (null = 전체 복원).
  ///
  /// 상세 화면이 떠 있는 동안 목록/요약 위젯의 rebuild 비용을 없애는 장치다.
  /// feed 구독과 상태 반영은 계속되므로(값은 최신 유지), 복원 시 flush 한 번으로
  /// 목록이 즉시 최신 상태가 된다 (DESIGN.md §6).
  ///
  /// 밀린 통지의 flush는 **마이크로태스크로 이연**한다: 이 메서드는 위젯의
  /// initState/dispose(= build/unmount로 트리가 잠긴 구간)에서 호출되는데,
  /// 그 자리에서 notifyListeners를 하면 markNeedsBuild가 금지 구간에 걸린다.
  /// 범위 변경 자체는 즉시 반영되므로 이후 도착하는 배치는 새 범위를 따른다.
  void restrictNotifications(Set<int>? allowed) {
    _notifyScope = allowed;
    scheduleMicrotask(flushDeferred);
  }

  /// 앱이 화면에서 사라진 동안(백그라운드) 통지 전체를 멈춘다.
  ///
  /// [restrictNotifications]와 같은 원리의 수명 관리다: feed 구독과 값 반영은
  /// 계속되므로 상태는 항상 최신이고, 화면이 없는 동안의 rebuild 비용만 0이 된다.
  /// 복귀 시 밀린 통지를 일괄 flush해 즉시 최신 화면이 된다. 통지 범위(상세 화면)와
  /// 독립된 축으로 두어 서로의 상태를 덮어쓰지 않는다 - 상세 화면을 띄운 채
  /// 백그라운드에 갔다 와도 두 제한이 각자 올바르게 복원된다.
  void setNotificationsPaused(bool paused) {
    if (_notificationsPaused == paused) return;
    _notificationsPaused = paused;
    if (!paused) scheduleMicrotask(flushDeferred);
  }

  void dispose() {
    _disposed = true;
    _flushTimer?.cancel();
    for (final n in _quotes) {
      n.dispose();
    }
    _mcapSum.dispose();
    _top20.dispose();
  }
}

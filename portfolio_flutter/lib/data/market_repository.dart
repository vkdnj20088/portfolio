import 'dart:async';

import 'package:flutter/foundation.dart';

import '../feed/market_feed.dart';
import '../feed/market_models.dart';
import '../state/quote_store.dart';

enum FeedStatus { healthy, degraded }

/// feed 연결 상태 - 일시적 스트림 에러를 UI에 표현하기 위한 모델.
@immutable
class FeedHealth {
  const FeedHealth({
    required this.status,
    required this.errorCount,
    this.lastMessage,
  });

  final FeedStatus status;

  /// 세션 누적 에러 횟수.
  final int errorCount;

  final String? lastMessage;

  bool get isDegraded => status == FeedStatus.degraded;

  @override
  bool operator ==(Object other) =>
      other is FeedHealth &&
      other.status == status &&
      other.errorCount == errorCount &&
      other.lastMessage == lastMessage;

  @override
  int get hashCode => Object.hash(status, errorCount, lastMessage);
}

/// 데이터 계층 - feed 구독 수명과 에러 복구를 담당한다.
///
/// - 앱 전체에서 feed 구독은 이 저장소 **하나**뿐이다 (화면들은 [QuoteStore]의
///   notifier를 구독한다). 정합성 판정 지점을 한 곳으로 모으기 위함 (DESIGN.md §2).
/// - **에러 생존**: `listen`의 cancelOnError 기본값(false)을 유지하고 onError를
///   반드시 달아, 에러가 와도 구독이 살아 다음 배치로 복구되게 한다.
///   (onError가 없으면 에러가 unhandled로 새어나간다 - 무시가 아니라 상태로 흡수)
/// - **복구 판정 히스테리시스**: 마지막 에러 후 [recoveryQuietMs] 이상 조용한
///   상태에서 정상 배치가 도착해야 healthy로 되돌린다. 에러가 잦을 때 배너가
///   프레임 단위로 깜빡이는 것을 막는다 (DESIGN.md §4).
class MarketRepository {
  MarketRepository({
    required this.feed,
    required this.store,
    int Function()? nowMs,
    this.recoveryQuietMs = 1000,
  }) : _nowMs = nowMs ?? _wallClockMs;

  static int _wallClockMs() => DateTime.now().millisecondsSinceEpoch;

  final MarketFeed feed;
  final QuoteStore store;

  /// 마지막 에러 이후 이 시간(ms) 이상 조용해야 healthy 복귀.
  final int recoveryQuietMs;

  final int Function() _nowMs;

  StreamSubscription<List<QuoteTick>>? _sub;
  int _lastErrorAtMs = 0;
  int _errorCount = 0;

  final ValueNotifier<FeedHealth> health = ValueNotifier(
    const FeedHealth(status: FeedStatus.healthy, errorCount: 0),
  );

  /// 스냅샷을 스토어에 싣고 tick 구독을 시작한다.
  void attach() {
    if (_sub != null) return;
    store.load(feed.initialSnapshot());
    _sub = feed.ticks.listen(_onBatch, onError: _onError);
  }

  void _onBatch(List<QuoteTick> batch) {
    store.applyBatch(batch);
    if (health.value.isDegraded &&
        _nowMs() - _lastErrorAtMs >= recoveryQuietMs) {
      health.value = FeedHealth(
        status: FeedStatus.healthy,
        errorCount: _errorCount,
      );
    }
  }

  void _onError(Object error, StackTrace stackTrace) {
    _errorCount++;
    _lastErrorAtMs = _nowMs();
    health.value = FeedHealth(
      status: FeedStatus.degraded,
      errorCount: _errorCount,
      lastMessage: error.toString(),
    );
  }

  void dispose() {
    _sub?.cancel();
    _sub = null;
    health.dispose();
  }
}

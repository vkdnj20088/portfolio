/// 도메인 계층 - seed의 raw 타입([QuoteTick]/[QuoteSnapshotEntry])을 앱이 소비하는
/// 형태로 변환한 모델. 변환 경계는 QuoteStore.applyBatch 한 곳이다 (DESIGN.md §2).
library;

/// 종목의 거래 상태 3단 모델.
///
/// seed의 [QuoteStatus]는 active/halted 2단이지만, 스냅샷에는 정지 정보가 없고
/// 정지/해제는 해당 종목의 tick이 도착해야만 관측된다. 따라서 "아직 tick을 한 번도
/// 받지 못해 정지 여부를 알 수 없는" 구간이 반드시 존재하며, 이를 [unknown]으로
/// 명시적으로 모델링한다 (안이하게 active로 간주하지 않는다 - DESIGN.md §3).
enum TradingState {
  /// 구독 이후 이 종목의 tick을 아직 받지 못함 - 정지 여부를 알 수 없음.
  unknown,

  /// 정상 거래 중 (최신 tick이 active).
  active,

  /// 거래정지 (최신 tick이 halted). 가격/거래량은 직전 값으로 고정.
  halted,
}

/// 한 종목의 현재 시세 상태. 불변 객체이며 종목별 notifier의 값으로 쓰인다.
class Quote {
  const Quote({
    required this.price,
    required this.dayVolume,
    required this.timestampMs,
    required this.state,
    required this.previousClose,
  });

  /// 현재가 (원). [state]가 [TradingState.unknown]이면 스냅샷 가격.
  final double price;

  /// 당일 누적 거래량.
  final int dayVolume;

  /// 이 값을 만든 tick의 timestampMs. 스냅샷 초기값은 -1 (tick 미수신 표식).
  final int timestampMs;

  final TradingState state;

  /// 전일 종가 - 세션 동안 고정 (스냅샷에서만 제공됨).
  final double previousClose;

  double get changeAmount => price - previousClose;

  /// 전일 대비 등락률 (%).
  double get changeRate =>
      previousClose == 0 ? 0 : (price - previousClose) / previousClose * 100;

  bool get isHalted => state == TradingState.halted;
}

/// JC Ticker 데이터 소스의 원시(raw) 타입.
///
/// [MarketFeed] 가 내보내는 형태 그대로이며, 앱은 이 타입을 도메인 모델
/// ([Quote])로 변환해 쓴다 - 경계는 data/market_repository.dart 에 있다.
library;

enum MarketType { kospi, kosdaq }

/// 종목의 실시간 거래 상태.
enum QuoteStatus {
  /// 정상 거래 중.
  active,

  /// 거래정지(halt). 이 구간의 [QuoteTick.price] 는 직전 체결가로 고정된다.
  halted,
}

/// 종목의 정적 메타데이터. 앱 수명 동안 바뀌지 않는다.
class SymbolInfo {
  const SymbolInfo({
    required this.code,
    required this.name,
    required this.market,
    required this.listedShares,
  });

  /// 6자리 종목코드. 예: "000001"
  final String code;

  /// 종목명. 예: "한빛전자"
  final String name;

  final MarketType market;

  /// 상장 주식 수 (시가총액 계산에 사용).
  final int listedShares;
}

/// 스트림으로 밀려오는 한 건의 시세 갱신.
///
/// feed 는 이 값을 배치(`List<QuoteTick>`)로 내보내고, 한 배치 안에 같은
/// 종목은 최대 한 번 등장한다.
///
/// 도착 순서는 시간 순서가 아니다 - 일부 tick 은 지연되어 더 최신 tick 보다
/// 나중에(더 작은 [timestampMs] 를 달고) 도착한다. 정합성은 소비 측이
/// [timestampMs] 단조 비교로 보장해야 한다 (state/quote_store.dart).
class QuoteTick {
  const QuoteTick({
    required this.code,
    required this.price,
    required this.dayVolume,
    required this.timestampMs,
    this.status = QuoteStatus.active,
  });

  final String code;

  /// 현재가 (원). [status] 가 [QuoteStatus.halted] 이면 직전 체결가로 고정.
  final double price;

  /// 당일 누적 거래량.
  final int dayVolume;

  /// 이 tick 이 관측된 시각 (feed 내부 시계 기준, epoch milliseconds).
  /// 도착 순서와 무관하게 이 값이 이벤트의 실제 시간 순서다.
  final int timestampMs;

  final QuoteStatus status;
}

/// feed 구독 직후 받는 전체 스냅샷의 한 종목 항목.
class QuoteSnapshotEntry {
  const QuoteSnapshotEntry({
    required this.info,
    required this.previousClose,
    required this.price,
    required this.dayVolume,
  });

  final SymbolInfo info;

  /// 전일 종가. 등락률/등락폭 계산의 기준값이며 세션 동안 고정.
  final double previousClose;

  final double price;
  final int dayVolume;
}

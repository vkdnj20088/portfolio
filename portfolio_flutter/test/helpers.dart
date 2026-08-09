import 'package:jc_ticker/feed/market_models.dart';

/// 테스트용 스냅샷 항목 생성기.
QuoteSnapshotEntry snapshotEntry(
  String code, {
  required double price,
  double? previousClose,
  int dayVolume = 0,
  int listedShares = 1000,
  String name = '테스트종목',
}) {
  return QuoteSnapshotEntry(
    info: SymbolInfo(
      code: code,
      name: name,
      market: MarketType.kospi,
      listedShares: listedShares,
    ),
    previousClose: previousClose ?? price,
    price: price,
    dayVolume: dayVolume,
  );
}

/// 테스트용 tick 생성기.
QuoteTick tick(
  String code, {
  required double price,
  required int ts,
  int volume = 0,
  QuoteStatus status = QuoteStatus.active,
}) {
  return QuoteTick(
    code: code,
    price: price,
    dayVolume: volume,
    timestampMs: ts,
    status: status,
  );
}

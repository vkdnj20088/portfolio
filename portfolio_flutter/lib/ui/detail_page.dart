import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../domain/quote.dart';
import '../feed/market_models.dart';
import '../state/quote_store.dart';
import 'format.dart';
import 'sparkline.dart';

/// 종목 상세 화면.
///
/// 구독 수명 관리 (DESIGN.md §6): 이 화면이 떠 있는 동안
/// [QuoteStore.restrictNotifications]로 통지 범위를 이 종목 하나로 제한한다.
/// feed 구독과 상태 반영은 계속되므로(값은 항상 최신), 뒤에 깔린 목록/요약/Top-20
/// 위젯들은 rebuild 비용 없이 멈춰 있다가, 화면을 나가는 순간 flush 한 번으로
/// 즉시 최신 상태로 복원된다.
class DetailPage extends StatefulWidget {
  const DetailPage({super.key, required this.store, required this.index});

  final QuoteStore store;
  final int index;

  @override
  State<DetailPage> createState() => _DetailPageState();
}

class _DetailPageState extends State<DetailPage> {
  static const int _ringCapacity = 180;

  late final ValueListenable<Quote> _quote;
  late final PriceRing _ring;
  final ValueNotifier<int> _paintTick = ValueNotifier(0);
  late double _lastPrice;
  late TradingState _lastState;

  @override
  void initState() {
    super.initState();
    _quote = widget.store.quoteListenable(widget.index);
    final q = _quote.value;
    _ring = PriceRing(_ringCapacity)..add(q.price);
    _lastPrice = q.price;
    _lastState = q.state;
    _quote.addListener(_onQuote);
    // 목록 화면의 갱신 비용 차단 - 통지를 이 종목으로 제한.
    widget.store.restrictNotifications({widget.index});
  }

  void _onQuote() {
    final q = _quote.value;
    // 가격이 실제로 바뀐 tick만 히스토리에 적재 - 거래량만 바뀐 tick으로는
    // 스파크라인을 다시 그리지 않는다. 상태 전환(정지-재개)은 색 반영을 위해 repaint.
    var repaint = false;
    if (q.price != _lastPrice) {
      _ring.add(q.price);
      _lastPrice = q.price;
      repaint = true;
    }
    if (q.state != _lastState) {
      _lastState = q.state;
      repaint = true;
    }
    if (repaint) _paintTick.value++;
  }

  @override
  void dispose() {
    _quote.removeListener(_onQuote);
    // 통지 범위 복원 - 밀려 있던 목록/요약 통지가 여기서 한 번에 flush된다.
    widget.store.restrictNotifications(null);
    _paintTick.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final info = widget.store.symbolAt(widget.index);
    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(info.name, style: const TextStyle(fontSize: 17)),
            Text(
              '${info.code} · ${info.market == MarketType.kospi ? 'KOSPI' : 'KOSDAQ'}',
              style: const TextStyle(fontSize: 11, color: Color(0xFF8E8E93)),
            ),
          ],
        ),
      ),
      body: ValueListenableBuilder<Quote>(
        valueListenable: _quote,
        builder: (context, q, _) {
          final rateColor = changeColor(q.changeRate);
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    formatPrice(q.price),
                    key: ValueKey('detail-price-${info.code}'),
                    style: TextStyle(
                      fontSize: 30,
                      fontWeight: FontWeight.w700,
                      color: q.isHalted
                          ? const Color(0xFF8E8E93)
                          : q.changeRate == 0
                          ? null
                          : rateColor,
                      fontFeatures: const [FontFeature.tabularFigures()],
                    ),
                  ),
                  const SizedBox(width: 10),
                  Padding(
                    padding: const EdgeInsets.only(bottom: 4),
                    child: Text(
                      '${formatSignedAmount(q.changeAmount)}  ${formatSignedRate(q.changeRate)}',
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        color: rateColor,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              _StateChip(state: q.state),
              const SizedBox(height: 16),
              Sparkline(
                ring: _ring,
                quote: _quote,
                repaint: _paintTick,
                previousClose: q.previousClose,
              ),
              const SizedBox(height: 20),
              _StatsGrid(store: widget.store, index: widget.index, quote: q),
              const SizedBox(height: 12),
              const Text(
                '시가·고가·저가는 구독 시작(스냅샷) 이후 관측 기준입니다.',
                style: TextStyle(fontSize: 11, color: Color(0xFF8E8E93)),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _StateChip extends StatelessWidget {
  const _StateChip({required this.state});

  final TradingState state;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final haltColor = dark ? const Color(0xFFFFB340) : const Color(0xFFB26500);
    final (label, color) = switch (state) {
      TradingState.halted => ('거래정지 (가격은 직전 체결가로 고정)', haltColor),
      TradingState.unknown => ('상태 확인 중 (첫 시세 대기)', const Color(0xFF8E8E93)),
      TradingState.active => ('정상 거래 중', const Color(0xFF34C759)),
    };
    return Row(
      children: [
        Container(
          width: 7,
          height: 7,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
        ),
        const SizedBox(width: 6),
        Text(label, style: TextStyle(fontSize: 12, color: color)),
      ],
    );
  }
}

class _StatsGrid extends StatelessWidget {
  const _StatsGrid({
    required this.store,
    required this.index,
    required this.quote,
  });

  final QuoteStore store;
  final int index;
  final Quote quote;

  @override
  Widget build(BuildContext context) {
    final info = store.symbolAt(index);
    // 종목 하나의 시총은 int 안전 범위(~2.5e14 < 2^53)지만, formatMarketCap이
    // 합계용 BigInt 시그니처라 여기서 변환한다.
    final marketCap =
        BigInt.from(quote.price.round()) * BigInt.from(info.listedShares);
    final items = <(String, String)>[
      ('시가', formatPrice(store.openPriceAt(index))),
      ('고가', formatPrice(store.sessionHighAt(index))),
      ('저가', formatPrice(store.sessionLowAt(index))),
      ('거래량', formatThousands(quote.dayVolume)),
      ('전일 종가', formatPrice(quote.previousClose)),
      ('시가총액', formatMarketCap(marketCap)),
    ];
    return Container(
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(10),
      ),
      padding: const EdgeInsets.all(12),
      child: Column(
        children: [
          for (var row = 0; row < items.length; row += 2)
            Padding(
              padding: EdgeInsets.only(bottom: row + 2 < items.length ? 10 : 0),
              child: Row(
                children: [
                  Expanded(child: _StatCell(item: items[row])),
                  if (row + 1 < items.length)
                    Expanded(child: _StatCell(item: items[row + 1])),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _StatCell extends StatelessWidget {
  const _StatCell({required this.item});

  final (String, String) item;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(
          item.$1,
          style: const TextStyle(fontSize: 12, color: Color(0xFF8E8E93)),
        ),
        Padding(
          padding: const EdgeInsets.only(right: 16),
          child: Text(
            item.$2,
            style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
          ),
        ),
      ],
    );
  }
}

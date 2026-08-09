import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../domain/quote.dart';
import '../feed/market_models.dart';
import 'format.dart';

/// 관심종목 목록의 행 하나.
///
/// 성능 설계 (PERF.md §3):
/// - 자기 종목의 [ValueListenable]에만 구독 -> 다른 1,999종목의 tick으로는
///   이 행이 절대 rebuild되지 않는다.
/// - [RepaintBoundary]로 행 단위 repaint 격리 -> 한 행의 텍스트 변경이 목록
///   레이어 전체 raster를 유발하지 않는다.
/// - 부모 ListView의 itemExtent(고정 높이)와 짝을 이뤄 layout 비용을 상수화.
class QuoteRow extends StatelessWidget {
  const QuoteRow({
    super.key,
    required this.info,
    required this.quote,
    this.onTap,
  });

  final SymbolInfo info;
  final ValueListenable<Quote> quote;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return RepaintBoundary(
      child: InkWell(
        onTap: onTap,
        child: ValueListenableBuilder<Quote>(
          valueListenable: quote,
          builder: (context, q, _) => _RowBody(info: info, quote: q),
        ),
      ),
    );
  }
}

class _RowBody extends StatelessWidget {
  const _RowBody({required this.info, required this.quote});

  final SymbolInfo info;
  final Quote quote;

  @override
  Widget build(BuildContext context) {
    final badge = stateBadge(quote.state);
    final rateColor = changeColor(quote.changeRate);
    // 현재가도 등락 방향색으로 표기한다 (국내 시세 앱 관행). 보합은 기본색,
    // 정지는 회색 고정 - 색만 바뀌므로 rebuild 비용 구조는 동일하다.
    final priceColor = quote.isHalted
        ? const Color(0xFF8E8E93)
        : quote.changeRate == 0
        ? Theme.of(context).colorScheme.onSurface
        : rateColor;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Row(
        children: [
          Expanded(
            flex: 5,
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Flexible(
                      child: Text(
                        info.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                    if (badge != null) ...[
                      const SizedBox(width: 6),
                      _HaltBadge(label: badge),
                    ],
                  ],
                ),
                const SizedBox(height: 2),
                Text(
                  '${info.code} · ${info.market == MarketType.kospi ? 'KOSPI' : 'KOSDAQ'}',
                  style: const TextStyle(
                    fontSize: 11,
                    color: Color(0xFF8E8E93),
                  ),
                ),
              ],
            ),
          ),
          Expanded(
            flex: 4,
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  formatPrice(quote.price),
                  key: ValueKey('price-${info.code}'),
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: priceColor,
                    fontFeatures: const [FontFeature.tabularFigures()],
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  formatSignedRate(quote.changeRate),
                  style: TextStyle(
                    fontSize: 12,
                    color: rateColor,
                    fontFeatures: const [FontFeature.tabularFigures()],
                  ),
                ),
              ],
            ),
          ),
          Expanded(
            flex: 3,
            child: Text(
              formatThousands(quote.dayVolume),
              textAlign: TextAlign.right,
              style: const TextStyle(
                fontSize: 11,
                color: Color(0xFF8E8E93),
                fontFeatures: [FontFeature.tabularFigures()],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _HaltBadge extends StatelessWidget {
  const _HaltBadge({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1.5),
      decoration: BoxDecoration(
        color: const Color(0x26FF9F0A),
        borderRadius: BorderRadius.circular(4),
        border: Border.all(color: const Color(0xFFFF9F0A), width: 0.7),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 9.5,
          color: dark ? const Color(0xFFFFB340) : const Color(0xFFB26500),
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

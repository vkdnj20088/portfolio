import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../domain/quote.dart';
import '../state/quote_store.dart';
import 'format.dart';

/// 실시간 등락률 상위 20 스트립.
///
/// 2단 구독 구조 (PERF.md §3):
/// - 스트립 구조(타일 나열)는 [QuoteStore.top20]에 구독 - **순위 순서가 바뀔 때만**
///   rebuild된다.
/// - 각 타일의 등락률 텍스트는 해당 종목의 notifier에 구독 - 순위가 그대로면
///   타일 내용만 갱신되고 스트립은 건드리지 않는다.
/// 동률 순위는 RankIndex의 (등락률 desc, 코드 asc) 결정적 tiebreak로 고정되어
/// rank thrashing이 없다.
class Top20Strip extends StatelessWidget {
  const Top20Strip({super.key, required this.store, this.onTapSymbol});

  final QuoteStore store;
  final void Function(int index)? onTapSymbol;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 80,
      child: ValueListenableBuilder<List<int>>(
        valueListenable: store.top20,
        builder: (context, order, _) {
          return ListView.builder(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 12),
            itemCount: order.length,
            // 타일 폭은 내용 최대 폭("+30.00%", 종목명 6자)이 축소 없이 들어가는
            // 값으로 고정한다 - FittedBox가 발동하면 타일마다 글자 크기가 달라진다.
            itemExtent: 112,
            itemBuilder: (context, i) {
              final symbolIndex = order[i];
              final info = store.symbolAt(symbolIndex);
              return _Top20Tile(
                key: ValueKey('top-${info.code}'),
                rank: i + 1,
                name: info.name,
                quote: store.quoteListenable(symbolIndex),
                onTap: onTapSymbol == null
                    ? null
                    : () => onTapSymbol!(symbolIndex),
              );
            },
          );
        },
      ),
    );
  }
}

class _Top20Tile extends StatelessWidget {
  const _Top20Tile({
    super.key,
    required this.rank,
    required this.name,
    required this.quote,
    this.onTap,
  });

  final int rank;
  final String name;
  final ValueListenable<Quote> quote;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return RepaintBoundary(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 3, vertical: 5),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(8),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
            decoration: BoxDecoration(
              color: Theme.of(context).colorScheme.surfaceContainerHighest,
              borderRadius: BorderRadius.circular(8),
            ),
            child: ValueListenableBuilder<Quote>(
              valueListenable: quote,
              builder: (context, q, _) {
                // FittedBox: 폰트 메트릭 차이로 고정 높이를 넘칠 때 잘리는 대신
                // 축소되도록 방어 (레이아웃 예외 방지).
                return FittedBox(
                  fit: BoxFit.scaleDown,
                  alignment: Alignment.centerLeft,
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      SizedBox(
                        width: 88,
                        child: Text(
                          '$rank위 $name',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        formatSignedRate(q.changeRate),
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
                          color: changeColor(q.changeRate),
                          fontFeatures: const [FontFeature.tabularFigures()],
                        ),
                      ),
                      Text(
                        q.isHalted ? '거래정지' : formatPrice(q.price),
                        style: TextStyle(
                          fontSize: 10,
                          color: q.isHalted
                              ? const Color(0xFFFFB340)
                              : const Color(0xFF8E8E93),
                          fontFeatures: const [FontFeature.tabularFigures()],
                        ),
                      ),
                    ],
                  ),
                );
              },
            ),
          ),
        ),
      ),
    );
  }
}

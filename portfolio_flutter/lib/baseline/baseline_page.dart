import 'dart:async';

import 'package:flutter/material.dart';

import '../domain/chosung.dart';
import '../feed/market_feed.dart';
import '../feed/market_models.dart';
import '../ui/format.dart';

/// PERF.md의 **baseline(before)** - 비교 기준이 되는 "가장 순진한" 구현.
///
/// 의도적으로 다음을 하지 않는다 (본 구현과의 대조가 목적):
/// - tick 배치마다 `setState()`로 **화면 전체 rebuild** (행별 구독 없음)
/// - 요약값(시총 합계)/Top-20/검색 필터를 **매 build마다 전체 재계산/재정렬**
/// - 행에 RepaintBoundary 없음, ListView itemExtent 없음
/// - timestamp 정합성 없음(도착 순서 last-write-wins -> 가격 역행 발생 가능)
/// - Top-20 정렬에 tiebreak 없음(unstable sort -> 동률 rank thrashing 발생)
///
/// `--dart-define=BASELINE=true`로 실행/벤치된다. 미수정 유지 - 개선은 전부
/// lib/{state,data,ui}에서 이루어진다.
class BaselineWatchlistPage extends StatefulWidget {
  const BaselineWatchlistPage({super.key, required this.feed});

  final MarketFeed feed;

  @override
  State<BaselineWatchlistPage> createState() => _BaselineWatchlistPageState();
}

class _BaselineWatchlistPageState extends State<BaselineWatchlistPage> {
  final Map<String, double> _price = {};
  final Map<String, int> _volume = {};
  final Map<String, QuoteStatus> _status = {};
  final Map<String, double> _prevClose = {};
  List<SymbolInfo> _symbols = const [];
  String _query = '';
  StreamSubscription<List<QuoteTick>>? _sub;

  @override
  void initState() {
    super.initState();
    _symbols = widget.feed.symbols;
    for (final e in widget.feed.initialSnapshot()) {
      _price[e.info.code] = e.price;
      _volume[e.info.code] = e.dayVolume;
      _prevClose[e.info.code] = e.previousClose;
    }
    _sub = widget.feed.ticks.listen(
      (batch) {
        // 순진한 소비: 배치마다 화면 전체 rebuild + 도착 순서 그대로 반영.
        setState(() {
          for (final t in batch) {
            _price[t.code] = t.price;
            _volume[t.code] = t.dayVolume;
            _status[t.code] = t.status;
          }
        });
      },
      onError: (Object _) {}, // 에러 무시 (baseline)
    );
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  double _rateOf(String code) {
    final prev = _prevClose[code]!;
    return prev == 0 ? 0 : (_price[code]! - prev) / prev * 100;
  }

  @override
  Widget build(BuildContext context) {
    // 매 build 전체 재계산 (의도적 baseline).
    var mcap = 0.0;
    for (final s in _symbols) {
      mcap += _price[s.code]! * s.listedShares;
    }
    final ranked = [..._symbols]
      ..sort((a, b) => _rateOf(b.code).compareTo(_rateOf(a.code)));
    final top20 = ranked.take(20).toList();
    final visible = _query.isEmpty
        ? _symbols
        : _symbols
              .where(
                (s) => matchesSymbol(
                  name: s.name,
                  code: s.code,
                  chosung: extractChosung(s.name), // 매 build 초성 재추출 (baseline)
                  query: _query,
                ),
              )
              .toList();

    return Scaffold(
      appBar: AppBar(title: const Text('관심종목 (baseline)')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 10, 16, 4),
            child: Row(
              children: [
                Text('표시 종목 ${formatThousands(visible.length)}'),
                const SizedBox(width: 16),
                Text('시총 합계 ${formatMarketCap(BigInt.from(mcap))}'),
              ],
            ),
          ),
          SizedBox(
            height: 74,
            child: ListView.builder(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 12),
              itemCount: top20.length,
              itemBuilder: (context, i) {
                final s = top20[i];
                final rate = _rateOf(s.code);
                return Padding(
                  padding: const EdgeInsets.all(4),
                  child: Container(
                    width: 88,
                    padding: const EdgeInsets.all(8),
                    color: Theme.of(
                      context,
                    ).colorScheme.surfaceContainerHighest,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '${i + 1}위 ${s.name}',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 11),
                        ),
                        Text(
                          formatSignedRate(rate),
                          style: TextStyle(
                            fontSize: 13,
                            color: changeColor(rate),
                          ),
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
            child: TextField(
              key: const Key('searchField'),
              onChanged: (q) => setState(() => _query = q.trim()),
              decoration: const InputDecoration(
                isDense: true,
                prefixIcon: Icon(Icons.search, size: 20),
                hintText: '종목명·초성·코드 검색',
                border: OutlineInputBorder(),
              ),
            ),
          ),
          Expanded(
            child: ListView.builder(
              key: const Key('watchList'),
              itemCount: visible.length,
              itemBuilder: (context, i) {
                final s = visible[i];
                final rate = _rateOf(s.code);
                final halted = _status[s.code] == QuoteStatus.halted;
                return SizedBox(
                  height: 56,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    child: Row(
                      children: [
                        Expanded(
                          flex: 5,
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                halted ? '${s.name} (정지)' : s.name,
                                style: const TextStyle(
                                  fontSize: 14,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                              Text(
                                s.code,
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
                              Text(formatPrice(_price[s.code]!)),
                              Text(
                                formatSignedRate(rate),
                                style: TextStyle(
                                  fontSize: 12,
                                  color: changeColor(rate),
                                ),
                              ),
                            ],
                          ),
                        ),
                        Expanded(
                          flex: 3,
                          child: Text(
                            formatThousands(_volume[s.code]!),
                            textAlign: TextAlign.right,
                            style: const TextStyle(
                              fontSize: 11,
                              color: Color(0xFF8E8E93),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

import 'package:flutter/material.dart';

import '../data/market_repository.dart';
import '../state/quote_store.dart';
import '../state/search_model.dart';
import 'detail_page.dart';
import 'quote_row.dart';
import 'summary_bar.dart';
import 'top20_strip.dart';

/// 화면 1 - 관심종목 목록.
///
/// rebuild 경계 (PERF.md §3):
/// - 이 페이지 자체는 tick으로 rebuild되지 않는다 (setState 없음).
/// - 목록 구조는 [SearchModel]에만 구독 -> 질의가 바뀔 때만 목록을 다시 만든다.
/// - 행 내용은 각 행이 자기 종목 notifier에 구독 -> tick은 보이는 행만 갱신한다.
/// - itemExtent 고정으로 스크롤 중 행 layout 비용을 상수화한다.
class WatchlistPage extends StatefulWidget {
  const WatchlistPage({
    super.key,
    required this.store,
    required this.search,
    required this.repository,
    this.onToggleTheme,
  });

  final QuoteStore store;
  final SearchModel search;
  final MarketRepository repository;

  /// 다크/라이트 전환 (앱 루트가 themeMode를 소유한다).
  final VoidCallback? onToggleTheme;

  @override
  State<WatchlistPage> createState() => _WatchlistPageState();
}

/// 목록 컬럼 헤더. 행(QuoteRow)과 같은 flex 비율(5/4/3)로 정렬을 맞춘다.
/// 정적 위젯이라 tick 경로의 rebuild 비용에 들지 않는다.
class _ListHeader extends StatelessWidget {
  const _ListHeader();

  static const _style = TextStyle(fontSize: 11, color: Color(0xFF6E6E73));

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.fromLTRB(16, 8, 16, 4),
      child: Row(
        children: [
          Expanded(flex: 5, child: Text('종목', style: _style)),
          Expanded(
            flex: 4,
            child: Text('현재가 / 등락률', textAlign: TextAlign.right, style: _style),
          ),
          Expanded(
            flex: 3,
            child: Text('거래량', textAlign: TextAlign.right, style: _style),
          ),
        ],
      ),
    );
  }
}

class _WatchlistPageState extends State<WatchlistPage> {
  final TextEditingController _searchController = TextEditingController();

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  void _openDetail(int symbolIndex) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => DetailPage(store: widget.store, index: symbolIndex),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('관심종목'),
        actions: [
          if (widget.onToggleTheme != null)
            IconButton(
              key: const Key('themeToggle'),
              onPressed: widget.onToggleTheme,
              tooltip: '다크/라이트 전환',
              iconSize: 18,
              color: const Color(0xFF8E8E93),
              icon: Icon(
                Theme.of(context).brightness == Brightness.dark
                    ? Icons.light_mode_outlined
                    : Icons.dark_mode_outlined,
              ),
            ),
          // 데모 식별용 캡션. 화면 본문 대신 앱 크롬 영역에 둔다.
          const Padding(
            padding: EdgeInsets.only(right: 16),
            child: Center(
              child: Text(
                'JC Ticker · 최종은',
                style: TextStyle(fontSize: 11, color: Color(0xFF6E6E73)),
              ),
            ),
          ),
        ],
      ),
      body: Column(
        children: [
          HealthBanner(health: widget.repository.health),
          SummaryBar(store: widget.store, search: widget.search),
          Top20Strip(store: widget.store, onTapSymbol: _openDetail),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
            child: TextField(
              key: const Key('searchField'),
              controller: _searchController,
              onChanged: widget.search.setQuery,
              decoration: InputDecoration(
                isDense: true,
                filled: true,
                fillColor: Theme.of(
                  context,
                ).colorScheme.surfaceContainerHighest,
                prefixIcon: const Icon(
                  Icons.search,
                  size: 20,
                  color: Color(0xFF8E8E93),
                ),
                hintText: '종목명·초성(ㄱㅇ)·코드 검색',
                hintStyle: const TextStyle(color: Color(0xFF6E6E73)),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: BorderSide.none,
                ),
                contentPadding: const EdgeInsets.symmetric(vertical: 8),
              ),
            ),
          ),
          const _ListHeader(),
          Expanded(
            child: ListenableBuilder(
              listenable: widget.search,
              builder: (context, _) {
                final visible = widget.search.visibleIndices;
                if (visible.isEmpty) {
                  return const Center(
                    child: Text(
                      '검색 결과가 없습니다',
                      style: TextStyle(color: Color(0xFF8E8E93)),
                    ),
                  );
                }
                return ListView.builder(
                  key: const Key('watchList'),
                  itemExtent: 56,
                  itemCount: visible.length,
                  itemBuilder: (context, i) {
                    final symbolIndex = visible[i];
                    final info = widget.store.symbolAt(symbolIndex);
                    return QuoteRow(
                      key: ValueKey('row-${info.code}'),
                      info: info,
                      quote: widget.store.quoteListenable(symbolIndex),
                      onTap: () => _openDetail(symbolIndex),
                    );
                  },
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

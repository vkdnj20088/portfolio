import 'dart:async';

import 'package:flutter/foundation.dart';

import '../domain/chosung.dart';
import '../feed/market_models.dart';

/// 검색(초성/종목명/코드) 상태.
///
/// 핵심 관찰 (DESIGN.md §5): 검색 대상(종목명/코드)은 **정적 메타데이터**다.
/// 따라서 검색 인덱스(초성열)는 생성 시 1회만 만들고, 필터 재계산은 오직
/// **질의가 바뀔 때만** 수행한다 - tick 유입과 완전히 무관하므로 "고빈도 tick이
/// 흐르는 중의 필터링" 비용은 구조적으로 0이다. 매 tick 재계산이 없는 이유는
/// 최적화가 아니라 이 분리 자체다.
///
/// keystroke debounce는 스캔 비용(us 수준) 때문이 아니라, 타이핑 burst마다
/// 필터된 ListView를 통째로 rebuild하는 비용을 모으기 위한 것이다.
class SearchModel extends ChangeNotifier {
  SearchModel(
    List<SymbolInfo> symbols, {
    this.debounce = const Duration(milliseconds: 120),
  }) : _names = List.unmodifiable([for (final s in symbols) s.name]),
       _codes = List.unmodifiable([for (final s in symbols) s.code]),
       _chosungs = List.unmodifiable([
         for (final s in symbols) extractChosung(s.name),
       ]) {
    _all = List.unmodifiable(List<int>.generate(symbols.length, (i) => i));
    _visible = _all;
  }

  final Duration debounce;
  final List<String> _names;
  final List<String> _codes;
  final List<String> _chosungs;

  late final List<int> _all;
  List<int> _visible = const [];
  String _query = '';
  Timer? _timer;

  String get query => _query;

  bool get isFiltered => _query.trim().isNotEmpty;

  /// 필터를 통과한 종목 index 목록 (전체면 항등 리스트).
  List<int> get visibleIndices => _visible;

  int get totalCount => _all.length;

  void setQuery(String raw) {
    final q = raw.trim();
    if (q == _query) return;
    _query = q;
    _timer?.cancel();
    if (debounce == Duration.zero) {
      _apply();
    } else {
      _timer = Timer(debounce, _apply);
    }
  }

  /// debounce를 기다리지 않고 즉시 적용 (테스트/벤치용).
  void applyNow() {
    _timer?.cancel();
    _apply();
  }

  void _apply() {
    if (_query.isEmpty) {
      _visible = _all;
    } else {
      final out = <int>[];
      for (var i = 0; i < _names.length; i++) {
        if (matchesSymbol(
          name: _names[i],
          code: _codes[i],
          chosung: _chosungs[i],
          query: _query,
        )) {
          out.add(i);
        }
      }
      _visible = out;
    }
    notifyListeners();
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }
}

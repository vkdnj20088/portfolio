import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import 'baseline/baseline_page.dart';
import 'data/market_repository.dart';
import 'feed/market_feed.dart';
import 'state/quote_store.dart';
import 'state/search_model.dart';
import 'ui/watchlist_page.dart';

/// true면 PERF.md 비교용 baseline(순진 구현)으로 부팅한다.
/// - 네이티브/벤치: flutter run --profile --dart-define=BASELINE=true
/// - web 데모: `?baseline=1` 쿼리 - 한 배포에서 개선본/순진본을 나란히 열어
///   비교할 수 있게 런타임 분기를 함께 둔다 (컴파일 분기만으로는 배포가 2벌).
final bool kBaselineMode =
    const bool.fromEnvironment('BASELINE') ||
    (kIsWeb && Uri.base.queryParameters['baseline'] == '1');

/// 통지 flush 주기(ms). 0 = 배치 도착 즉시(기본, PERF.md 스윕으로 선정).
/// 실행: flutter run --profile --dart-define=NOTIFY_MS=50
const int kNotifyIntervalMs = int.fromEnvironment('NOTIFY_MS');

void main() {
  runApp(const WatchlistApp());
}

/// 앱 조립 루트 - feed/store/repository/search의 소유자.
///
/// 테스트/벤치마크에서는 [feed]를 주입하고 [autoStart]를 끈 뒤 `feed.pump()`로
/// 결정론적으로 구동한다 (구독은 attach에서 이미 걸리므로 pump 순서 문제 없음).
class WatchlistApp extends StatefulWidget {
  const WatchlistApp({super.key, this.feed, this.autoStart = true});

  final MarketFeed? feed;
  final bool autoStart;

  @override
  State<WatchlistApp> createState() => WatchlistAppState();
}

class WatchlistAppState extends State<WatchlistApp>
    with WidgetsBindingObserver {
  late final MarketFeed feed;
  late final bool _ownsFeed;
  QuoteStore? _store;
  MarketRepository? _repository;
  SearchModel? _search;

  /// 테스트 검증용 접근자 (baseline 모드에서는 null).
  QuoteStore? get store => _store;
  MarketRepository? get repository => _repository;
  SearchModel? get search => _search;

  @override
  void initState() {
    super.initState();
    feed = widget.feed ?? MarketFeed();
    _ownsFeed = widget.feed == null;
    if (!kBaselineMode) {
      final store = QuoteStore(notifyIntervalMs: kNotifyIntervalMs);
      final repository = MarketRepository(feed: feed, store: store);
      repository.attach(); // 스냅샷 적재 + 구독 시작 (pump보다 먼저)
      _store = store;
      _repository = repository;
      _search = SearchModel(store.symbols);
      WidgetsBinding.instance.addObserver(this);
    }
    if (widget.autoStart) feed.start();
  }

  /// 백그라운드에서는 통지를 멈춘다 (값 반영은 계속 - QuoteStore 주석 참조).
  /// inactive는 앱 전환 UI 등 화면이 아직 보이는 상태이므로 통지를 유지한다.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final visible =
        state == AppLifecycleState.resumed ||
        state == AppLifecycleState.inactive;
    _store?.setNotificationsPaused(!visible);
  }

  @override
  void dispose() {
    if (!kBaselineMode) WidgetsBinding.instance.removeObserver(this);
    _repository?.dispose();
    _store?.dispose();
    _search?.dispose();
    if (_ownsFeed) feed.dispose();
    super.dispose();
  }

  /// 기본은 다크. 시세 화면은 어두운 배경에서 등락색 대비가 좋아 국내 증권앱의
  /// 사실상 표준이다. 라이트는 앱바의 토글로 전환한다 (시스템 설정 연동은
  /// 이 데모의 축 밖이라 두지 않았다 - DESIGN.md 9절).
  ThemeMode _themeMode = ThemeMode.dark;

  void _toggleTheme() {
    setState(() {
      _themeMode = _themeMode == ThemeMode.dark
          ? ThemeMode.light
          : ThemeMode.dark;
    });
  }

  ThemeData _theme(Brightness brightness) {
    final dark = brightness == Brightness.dark;
    final scheme =
        ColorScheme.fromSeed(
          seedColor: const Color(0xFF3182F6),
          brightness: brightness,
        ).copyWith(
          surface: dark ? const Color(0xFF17171C) : Colors.white,
          surfaceContainerHighest: dark
              ? const Color(0xFF26262C)
              : const Color(0xFFF2F3F5),
        );
    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: scheme.surface,
      appBarTheme: AppBarTheme(
        backgroundColor: scheme.surface,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        titleTextStyle: TextStyle(
          fontSize: 20,
          fontWeight: FontWeight.w700,
          color: dark ? const Color(0xFFE5E5EA) : const Color(0xFF191F28),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'JC Ticker - 실시간 관심종목',
      debugShowCheckedModeBanner: false,
      theme: _theme(Brightness.light),
      darkTheme: _theme(Brightness.dark),
      themeMode: _themeMode,
      home: kBaselineMode
          ? BaselineWatchlistPage(feed: feed)
          : WatchlistPage(
              store: _store!,
              search: _search!,
              repository: _repository!,
              onToggleTheme: _toggleTheme,
            ),
    );
  }
}

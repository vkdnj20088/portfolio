/// JC Ticker 의 결정론적 로컬 시세 소스.
///
/// 실서비스라면 WebSocket/폴링 피드가 있을 자리를 로컬 시뮬레이터로 채운다.
/// 데모/벤치마크가 같은 입력을 재현할 수 있도록, 모든 무작위성은 생성자
/// [seed] 하나에서 나온다 - 같은 seed + 같은 배치 수열이면 tick 시퀀스가
/// 바이트 단위로 동일하다.
///
/// 부하와 결함 모델은 실제 시세 피드의 성질을 따른다:
///
/// - 종목 2,000개 (KOSPI/KOSDAQ 혼합), 초당 60배치 × 배치당 최대 250건
///   = 초당 최대 15,000 갱신
/// - **지연·역순 tick**: 일부 tick 은 지연 방출되어, 더 최신 tick 보다 나중에
///   (더 작은 timestampMs 를 달고) 도착한다 - 도착 순서 != 시간 순서.
/// - **거래정지(halt)**: 수시로 정지/해제되고, 정지 구간의 tick 은
///   [QuoteStatus.halted] 에 가격 고정이다.
/// - **일시적 스트림 에러**: 소켓처럼 [ticks] 가 간헐적으로 에러를 낼 수 있다
///   (기본 0, [transientErrorProbability] 로 켠다). 스트림은 닫히지 않으므로
///   구독을 유지한 채 복구해야 한다.
///
/// 이 파일은 데이터 소스 역할만 한다 - 캐싱/스로틀/정렬은 넣지 않는다. 그런
/// 처리는 위 계층(data/, state/)의 책임이고, 실피드로 교체할 때 이 파일만
/// 걷어내면 되는 경계를 유지하기 위해서다.
library;

import 'dart:async';
import 'dart:math';

import 'market_models.dart';

class MarketFeed {
  MarketFeed({
    this.symbolCount = 2000,
    this.batchesPerSecond = 60,
    this.updatesPerBatch = 250,
    this.lateTickProbability = 0.008,
    this.haltProbability = 0.002,
    this.transientErrorProbability = 0.0,
    int seed = 20260810,
  }) : _rng = Random(seed) {
    _buildUniverse();
  }

  /// 생성할 종목 수.
  final int symbolCount;

  /// 초당 스트림 배치 수 (기본 60Hz).
  final int batchesPerSecond;

  /// 한 배치에서 갱신되는 종목 수의 상한.
  final int updatesPerBatch;

  /// tick 하나가 지연되어 나중 배치에서 (원래 timestampMs 그대로) 방출될 확률.
  final double lateTickProbability;

  /// 매 배치에서 새 거래정지가 발생할 확률. 정지는 1~6초 뒤 자동 해제된다.
  final double haltProbability;

  /// 매 배치 후 [ticks] 스트림에 일시적 에러를 실을 확률 (기본 0).
  final double transientErrorProbability;

  final Random _rng;

  /// 종목별 시세 장부. 인덱스 순서가 [symbols] 의 순서다.
  final List<_SymbolBook> _books = [];

  /// 지연 tick 대기열: 해제 예정 배치 index -> 그 배치에서 풀 tick 들.
  final Map<int, List<QuoteTick>> _pendingByBatch = {};

  int _clockMs = 0;
  int _batchIndex = 0;
  Timer? _timer;

  final StreamController<List<QuoteTick>> _out =
      StreamController<List<QuoteTick>>.broadcast();

  /// 종목 정적 메타데이터. 순서는 고정이다.
  List<SymbolInfo> get symbols => List.unmodifiable(_books.map((b) => b.info));

  /// 구독 시작 시점의 전체 시세 스냅샷.
  List<QuoteSnapshotEntry> initialSnapshot() {
    return _books
        .map(
          (b) => QuoteSnapshotEntry(
            info: b.info,
            previousClose: b.previousClose,
            price: b.price,
            dayVolume: b.dayVolume,
          ),
        )
        .toList(growable: false);
  }

  /// 고빈도 시세 배치 스트림. [start] 를 호출해야 흐르기 시작한다.
  Stream<List<QuoteTick>> get ticks => _out.stream;

  void start() {
    if (_timer != null) return;
    final period = Duration(microseconds: 1000000 ~/ batchesPerSecond);
    _timer = Timer.periodic(period, (_) => _emitBatch());
  }

  void stop() {
    _timer?.cancel();
    _timer = null;
  }

  /// 결정론적 벤치마크용 - 타이머 없이 [count]개의 배치를 즉시 방출한다.
  ///
  /// [start] 와 달리 벽시계에 의존하지 않으므로 같은 seed 로는 항상 같은
  /// tick 수열이 재현된다. 호출 전에 [ticks] 에 리스너가 붙어 있어야 방출된다.
  void pump([int count = 1]) {
    for (var i = 0; i < count; i++) {
      _emitBatch();
    }
  }

  void dispose() {
    stop();
    _out.close();
  }

  void _emitBatch() {
    if (_out.isClosed || !_out.hasListener) return;
    _batchIndex++;
    _clockMs += 1000 ~/ batchesPerSecond;

    _maybeStartHalt();

    final batch = <QuoteTick>[];
    final inBatch = <String>{};

    // 이번 배치가 해제 시점인 지연 tick 을 원래 timestamp 그대로 먼저 싣는다.
    // 같은 배치에 같은 종목이 두 번 나가지 않도록, 겹치면 다음 배치로 넘긴다.
    final released = _pendingByBatch.remove(_batchIndex);
    if (released != null) {
      for (final tick in released) {
        if (inBatch.add(tick.code)) {
          batch.add(tick);
        } else {
          _defer(tick, _batchIndex + 1);
        }
      }
    }

    // 한 배치에 한 종목은 최대 1건 - 표본 수가 종목 수를 넘을 수 없다.
    final target = 1 + _rng.nextInt(updatesPerBatch);
    while (batch.length < target && inBatch.length < _books.length) {
      final book = _books[_rng.nextInt(_books.length)];
      if (!inBatch.add(book.info.code)) continue;

      if (book.haltedUntilBatch > _batchIndex) {
        // 정지 구간: 가격/거래량은 고정, 상태만 halted 로 알린다.
        batch.add(
          QuoteTick(
            code: book.info.code,
            price: book.price,
            dayVolume: book.dayVolume,
            timestampMs: _clockMs,
            status: QuoteStatus.halted,
          ),
        );
        continue;
      }

      final tick = _advance(book);
      if (_rng.nextDouble() < lateTickProbability) {
        // 지연 방출 - 그 사이 같은 종목의 후속 tick 이 먼저 나가므로,
        // 이 tick 은 나중에 과거 시각을 달고 도착한다 (역순 도착 재현).
        _defer(tick, _batchIndex + 1 + _rng.nextInt(3));
      } else {
        batch.add(tick);
      }
    }

    _out.add(batch);

    if (transientErrorProbability > 0 &&
        _rng.nextDouble() < transientErrorProbability) {
      _out.addError(const MarketFeedException('일시적 피드 오류 - 구독 유지 상태로 복구 가능'));
    }
  }

  /// 호가단위 걸음의 랜덤워크로 한 종목을 한 tick 전진시킨다.
  ///
  /// 걸음을 호가단위로 양자화하는 이유: 곱셈 drift 가 호가단위보다 작으면
  /// 반올림에 먹혀 현재가가 움직이지 않는다 - 갱신이 실제로 보이려면 이동
  /// 자체를 호가단위 배수로 만들어야 한다.
  QuoteTick _advance(_SymbolBook book) {
    final steps = _rng.nextInt(5) - 2; // -2..+2
    final moved = book.price + steps * _krxTickSize(book.price);
    // 일일 등락 제한(±30%)은 전일 종가 기준.
    final clamped = moved.clamp(
      book.previousClose * 0.7,
      book.previousClose * 1.3,
    );
    book.price = _snapToTick(clamped);
    book.dayVolume += _rng.nextInt(800);
    return QuoteTick(
      code: book.info.code,
      price: book.price,
      dayVolume: book.dayVolume,
      timestampMs: _clockMs,
    );
  }

  void _defer(QuoteTick tick, int releaseAtBatch) {
    _pendingByBatch.putIfAbsent(releaseAtBatch, () => []).add(tick);
  }

  /// 낮은 확률로 임의 종목에 1~6초(배치 60~360개) 거래정지를 건다.
  /// 해제는 별도 정리 없이 배치 index 비교로 판정한다.
  void _maybeStartHalt() {
    if (_rng.nextDouble() >= haltProbability) return;
    final book = _books[_rng.nextInt(_books.length)];
    book.haltedUntilBatch = _batchIndex + 60 + _rng.nextInt(300);
  }

  void _buildUniverse() {
    for (var i = 0; i < symbolCount; i++) {
      final code = (i + 1).toString().padLeft(6, '0');
      // 기준가는 로그 균등 분포(1,000 ~ 약 50만 원) - 실제 시장처럼 저가 종목이
      // 다수, 고가 종목이 소수가 되게 한다.
      final base = pow(10, 3 + _rng.nextDouble() * 2.7).toDouble();
      final basePrice = _snapToTick(base);
      final book = _SymbolBook(
        info: SymbolInfo(
          code: code,
          name: _nameFor(i),
          market: i.isEven ? MarketType.kospi : MarketType.kosdaq,
          listedShares: 1000000 + _rng.nextInt(500000000),
        ),
        previousClose: basePrice,
        price: basePrice,
        dayVolume: _rng.nextInt(2000000),
      );
      _books.add(book);
    }
  }

  /// 가상의 종목명 생성 - 실존 상장사와 겹치지 않는 조합어를 쓴다.
  String _nameFor(int i) {
    const heads = [
      '한빛',
      '두레',
      '미르',
      '보람',
      '새론',
      '아람',
      '예솔',
      '우람',
      '이든',
      '조은',
      '푸른',
      '해온',
      '가람',
      '늘솔',
      '바다',
      '소리',
    ];
    const tails = [
      '전자',
      '정보',
      '화학',
      '제강',
      '생명',
      '유통',
      '상사',
      '기계',
      '전기',
      '섬유',
      '시스템',
      '건설',
      '식품',
      '제약',
      '통신',
      '산업',
    ];
    return heads[i % heads.length] + tails[(i ~/ heads.length) % tails.length];
  }

  /// KRX 호가단위 (2023년 개편 기준의 구간표).
  int _krxTickSize(double price) {
    if (price < 2000) return 1;
    if (price < 5000) return 5;
    if (price < 20000) return 10;
    if (price < 50000) return 50;
    if (price < 200000) return 100;
    if (price < 500000) return 500;
    return 1000;
  }

  double _snapToTick(double price) {
    final tick = _krxTickSize(price);
    return (price / tick).round() * tick.toDouble();
  }
}

/// 종목 하나의 가변 시세 상태 - feed 내부 전용.
class _SymbolBook {
  _SymbolBook({
    required this.info,
    required this.previousClose,
    required this.price,
    required this.dayVolume,
  });

  final SymbolInfo info;
  final double previousClose;
  double price;
  int dayVolume;

  /// 이 배치 index 전까지 거래정지. 기본 -1(정지 아님).
  int haltedUntilBatch = -1;
}

/// [MarketFeed.ticks] 스트림이 낼 수 있는 일시적 오류.
/// 스트림은 닫히지 않으며, 구독을 유지한 채 다음 배치로 복구된다.
class MarketFeedException implements Exception {
  const MarketFeedException(this.message);

  final String message;

  @override
  String toString() => 'MarketFeedException: $message';
}

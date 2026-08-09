import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../domain/quote.dart';
import 'format.dart';

/// 고정 용량 가격 링버퍼 - 스파크라인 히스토리.
///
/// 고빈도 tick 아래에서 히스토리가 무한정 커지지 않도록 용량을 고정하고,
/// 가득 차면 가장 오래된 점을 덮어쓴다. 추가는 O(1), 재할당 없음.
class PriceRing {
  PriceRing(this.capacity) : _data = Float64List(capacity);

  final int capacity;
  final Float64List _data;
  int _start = 0;
  int _length = 0;

  int get length => _length;

  double operator [](int i) => _data[(_start + i) % capacity];

  void add(double value) {
    if (_length < capacity) {
      _data[(_start + _length) % capacity] = value;
      _length++;
    } else {
      _data[_start] = value;
      _start = (_start + 1) % capacity;
    }
  }
}

/// 최근 체결가 스파크라인.
///
/// - repaint 트리거는 [repaint](가격/상태가 실제로 바뀐 경우에만 상세 화면이 bump)
///   이므로 값 불변 tick/거래량만 바뀐 tick으로는 다시 그리지 않는다.
/// - 매 프레임 위젯 rebuild 없이 painter만 다시 실행된다 (CustomPaint + Listenable).
/// - 전일 종가를 기준선(점선)으로 함께 그려 등락 방향을 읽을 수 있게 한다.
class Sparkline extends StatelessWidget {
  const Sparkline({
    super.key,
    required this.ring,
    required this.quote,
    required this.repaint,
    required this.previousClose,
  });

  final PriceRing ring;
  final ValueListenable<Quote> quote;
  final Listenable repaint;
  final double previousClose;

  @override
  Widget build(BuildContext context) {
    return RepaintBoundary(
      child: CustomPaint(
        size: const Size(double.infinity, 140),
        painter: _SparklinePainter(
          ring: ring,
          quote: quote,
          previousClose: previousClose,
          repaint: repaint,
        ),
      ),
    );
  }
}

class _SparklinePainter extends CustomPainter {
  _SparklinePainter({
    required this.ring,
    required this.quote,
    required this.previousClose,
    required Listenable repaint,
  }) : super(repaint: repaint);

  final PriceRing ring;
  final ValueListenable<Quote> quote;
  final double previousClose;

  /// 우측 라벨 열의 폭. 선 영역과 라벨이 겹치지 않도록 예약한다.
  static const double _labelGutter = 56;

  static TextPainter _label(
    String text, {
    Color color = const Color(0xFF6E6E73),
  }) {
    return TextPainter(
      text: TextSpan(
        text: text,
        style: TextStyle(
          fontSize: 10,
          color: color,
          fontFeatures: const [FontFeature.tabularFigures()],
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
  }

  @override
  void paint(Canvas canvas, Size size) {
    final n = ring.length;
    if (n < 2) return;

    var min = ring[0];
    var max = ring[0];
    for (var i = 1; i < n; i++) {
      final v = ring[i];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    // 기준선이 범위 안에 들어오도록 살짝 확장.
    if (previousClose < min) min = previousClose;
    if (previousClose > max) max = previousClose;
    final span = (max - min) == 0 ? 1.0 : (max - min);
    const padY = 10.0;
    final h = size.height - padY * 2;
    final plotW = size.width - _labelGutter;

    double yOf(double v) => padY + h * (1 - (v - min) / span);
    double xOf(int i) => plotW * i / (n - 1);

    // 전일 종가 기준선 (점선).
    final basePaint = Paint()
      ..color = const Color(0x338E8E93)
      ..strokeWidth = 1;
    final baseY = yOf(previousClose);
    const dash = 5.0;
    for (var x = 0.0; x < plotW; x += dash * 2) {
      canvas.drawLine(Offset(x, baseY), Offset(x + dash, baseY), basePaint);
    }

    // 세로축 단서: 버퍼 내 고가/저가와 전일 종가를 우측에 표기한다.
    // 스파크라인 관행상 눈금자는 두지 않되, 이 크기(전폭 140px)에서는 스케일
    // 단서가 없으면 그림이 읽히지 않아 미니 차트 수준의 라벨만 얹는다.
    // 가로축은 링버퍼가 시각을 저장하지 않으므로(고정 용량 가격 이력) 시간
    // 눈금 대신 표본 수를 정직하게 표기한다.
    final maxLabel = _label(formatPrice(max));
    maxLabel.paint(canvas, Offset(plotW + 6, yOf(max) - maxLabel.height / 2));
    final minLabel = _label(formatPrice(min));
    minLabel.paint(canvas, Offset(plotW + 6, yOf(min) - minLabel.height / 2));
    // 기준선 라벨은 고/저 라벨과 겹치면 생략한다 (기준선이 극값 근처일 때).
    if ((baseY - yOf(max)).abs() > 12 && (baseY - yOf(min)).abs() > 12) {
      final baseLabel = _label('전일 ${formatPrice(previousClose)}');
      baseLabel.paint(canvas, Offset(plotW + 6, baseY - baseLabel.height / 2));
    }
    final axisNote = _label('최근 체결 $n건, 좌측이 과거');
    axisNote.paint(canvas, Offset(0, size.height - axisNote.height));

    final halted = quote.value.isHalted;
    final rate = quote.value.changeRate;
    final lineColor = halted
        ? const Color(0xFF8E8E93)
        : rate > 0
        ? const Color(0xFFF04452)
        : rate < 0
        ? const Color(0xFF3182F6)
        : const Color(0xFF8E8E93);

    final path = Path()..moveTo(xOf(0), yOf(ring[0]));
    for (var i = 1; i < n; i++) {
      path.lineTo(xOf(i), yOf(ring[i]));
    }
    canvas.drawPath(
      path,
      Paint()
        ..color = lineColor
        ..strokeWidth = 1.6
        ..style = PaintingStyle.stroke
        ..strokeJoin = StrokeJoin.round,
    );

    // 마지막 체결점.
    canvas.drawCircle(
      Offset(xOf(n - 1), yOf(ring[n - 1])),
      2.6,
      Paint()..color = lineColor,
    );
  }

  @override
  bool shouldRepaint(_SparklinePainter oldDelegate) =>
      oldDelegate.ring != ring || oldDelegate.previousClose != previousClose;
}

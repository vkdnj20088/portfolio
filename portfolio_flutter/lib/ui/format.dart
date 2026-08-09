/// 숫자/색 포맷 유틸 - intl 의존 없이 필요한 것만 직접 구현 (DESIGN.md §7 의존성).
library;

import 'package:flutter/material.dart';

import '../domain/quote.dart';

/// 정수 천단위 콤마. 예: 1234567 -> '1,234,567'
String formatThousands(int n) {
  final negative = n < 0;
  var s = n.abs().toString();
  final buffer = StringBuffer();
  for (var i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 == 0) buffer.write(',');
    buffer.write(s[i]);
  }
  s = buffer.toString();
  return negative ? '-$s' : s;
}

/// 가격(원). 호가단위 반올림된 정수값이므로 콤마 정수로 표기.
String formatPrice(double price) => formatThousands(price.round());

/// 부호 포함 등락률. 예: +3.25% / -0.10% / 0.00%
String formatSignedRate(double rate) {
  final s = rate.toStringAsFixed(2);
  return rate > 0 ? '+$s%' : '$s%';
}

/// 부호 포함 등락폭(원).
String formatSignedAmount(double amount) {
  final v = amount.round();
  return v > 0 ? '+${formatThousands(v)}' : formatThousands(v);
}

/// 시가총액(원) - 경/조/억 단위 요약. 예: '1경 2,345조', '842조', '3,120억'
///
/// 인자가 BigInt인 이유: 전체 합계(~1.3e17)가 JS 컴파일의 int 정밀 상한(2^53)을
/// 넘어서, web 타깃에서는 합계 자체를 BigInt로 유지한다 (DESIGN.md §5, §10).
/// 단위 나눗셈 후의 몫은 항상 작은 수라 toInt()가 안전하다.
String formatMarketCap(BigInt won) {
  final jo = BigInt.from(1000000000000); // 1조
  final gyeong = jo * BigInt.from(10000); // 1경
  if (won >= gyeong) {
    final g = (won ~/ gyeong).toInt();
    final j = ((won % gyeong) ~/ jo).toInt();
    return '${formatThousands(g)}경 ${formatThousands(j)}조';
  }
  if (won >= jo) {
    return '${formatThousands((won ~/ jo).toInt())}조';
  }
  return '${formatThousands((won ~/ BigInt.from(100000000)).toInt())}억';
}

/// 등락 색 - 상승 빨강 / 하락 파랑 / 보합 회색 (국내 관례).
/// 다크 배경 대비가 좋은 채도로 조정한 값 (증권앱 관행 톤).
Color changeColor(double rate) {
  if (rate > 0) return const Color(0xFFF04452);
  if (rate < 0) return const Color(0xFF3182F6);
  return const Color(0xFF8E8E93);
}

/// 거래 상태 뱃지 텍스트 (없으면 null -> 뱃지 미표시).
///
/// halted만 뱃지로 구분한다. unknown(첫 tick 미수신)은 도메인에서는 구분하지만
/// UI에서는 뱃지를 달지 않는다 - 구독 직후 2,000행 전부에 "확인 중" 뱃지가 붙는
/// 노이즈를 피하기 위한 표시 판단 (DESIGN.md §3). 상세 화면에서는 표기한다.
String? stateBadge(TradingState state) =>
    state == TradingState.halted ? '거래정지' : null;

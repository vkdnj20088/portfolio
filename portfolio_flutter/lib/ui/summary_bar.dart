import 'dart:async';

import 'package:flutter/material.dart';

import '../data/market_repository.dart';
import '../state/quote_store.dart';
import '../state/search_model.dart';
import 'format.dart';

/// 목록 상단 요약 - 표시 종목 수(필터 기준) + 시가총액 합계(전체 기준, 실시간).
///
/// 구독 분리: 종목 수는 [SearchModel](질의 변경 시에만), 시총은
/// [QuoteStore.marketCapSum](증분 합계 notifier)에 각각 구독한다.
/// 집계 기준 판단은 DESIGN.md §5 참조 (표시 수 = 필터 통과 수/정지 포함,
/// 시총/Top-20 = 전체 2,000종목 기준).
class SummaryBar extends StatelessWidget {
  const SummaryBar({super.key, required this.store, required this.search});

  final QuoteStore store;
  final SearchModel search;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 2),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              ListenableBuilder(
                listenable: search,
                builder: (context, _) {
                  final visible = search.visibleIndices.length;
                  final total = search.totalCount;
                  return _SummaryItem(
                    label: '표시 종목',
                    value: search.isFiltered
                        ? '${formatThousands(visible)} / ${formatThousands(total)}'
                        : formatThousands(total),
                  );
                },
              ),
              const SizedBox(width: 24),
              ValueListenableBuilder<BigInt>(
                valueListenable: store.marketCapSum,
                builder: (context, sum, _) => _SummaryItem(
                  label: '시가총액 합계 (전체)',
                  value: formatMarketCap(sum),
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          ThroughputMeter(store: store),
        ],
      ),
    );
  }
}

/// 초당 수신 tick 수와 "화면 행 rebuild를 유발한 통지" 수를 나란히 보여주는 계측.
///
/// 이 격차가 이 설계의 요점이다: 유입은 초당 수천 건이지만
/// 화면 rebuild를 만드는 통지는 리스너가 붙은(=보이는) 행의 몫뿐이다 (PERF.md §2).
/// 실행만 해도 rebuild 격리를 눈으로 확인할 수 있도록 기본 노출한다.
///
/// 계측 자체가 프레임 비용을 만들지 않도록 **1초 주기**로만 갱신한다 - 60Hz
/// 갱신 경로(notifier)와 무관한 자체 타이머이며, 초당 텍스트 위젯 1개 rebuild가
/// 전부다. 카운터 증가는 상태 계층의 int 1회 증가로, 적용 경로 비용에 들지 않는다.
class ThroughputMeter extends StatefulWidget {
  const ThroughputMeter({super.key, required this.store});

  final QuoteStore store;

  @override
  State<ThroughputMeter> createState() => _ThroughputMeterState();
}

class _ThroughputMeterState extends State<ThroughputMeter> {
  Timer? _timer;
  int _lastProcessed = 0;
  int _lastRowNotified = 0;
  int _ticksPerSec = 0;
  int _rowNotifiesPerSec = 0;

  @override
  void initState() {
    super.initState();
    _lastProcessed = widget.store.processedTickCount;
    _lastRowNotified = widget.store.rowNotificationCount;
    _timer = Timer.periodic(const Duration(seconds: 1), (_) => _sample());
  }

  void _sample() {
    final processed = widget.store.processedTickCount;
    final rowNotified = widget.store.rowNotificationCount;
    setState(() {
      _ticksPerSec = processed - _lastProcessed;
      _rowNotifiesPerSec = rowNotified - _lastRowNotified;
    });
    _lastProcessed = processed;
    _lastRowNotified = rowNotified;
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Text(
      '초당 수신 ${formatThousands(_ticksPerSec)}건, '
      '행 rebuild 유발 ${formatThousands(_rowNotifiesPerSec)}회',
      key: const Key('throughputMeter'),
      style: const TextStyle(
        fontSize: 11,
        color: Color(0xFF8E8E93),
        fontFeatures: [FontFeature.tabularFigures()],
      ),
    );
  }
}

class _SummaryItem extends StatelessWidget {
  const _SummaryItem({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: const TextStyle(fontSize: 11, color: Color(0xFF8E8E93)),
        ),
        const SizedBox(height: 2),
        Text(
          value,
          style: const TextStyle(
            fontSize: 15,
            fontWeight: FontWeight.w700,
            // 시총 합계는 60Hz로 갱신된다 - 비례 숫자면 자릿수가 바뀔 때마다
            // 텍스트 폭이 변해 Row layout이 다시 돈다. 목록 행과 같은 이유로 고정 폭.
            fontFeatures: [FontFeature.tabularFigures()],
          ),
        ),
      ],
    );
  }
}

/// 일시적 feed 에러 배너 - degraded 동안만 표시된다.
///
/// 에러를 "무시"하지 않되 사용자를 방해하지도 않는 선: 구독은 유지/자동 복구되므로
/// 재시도 버튼 없이 상태만 알린다. 복구 판정의 히스테리시스는 repository 쪽 책임
/// (DESIGN.md §4).
class HealthBanner extends StatelessWidget {
  const HealthBanner({super.key, required this.health});

  final ValueNotifier<FeedHealth> health;

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<FeedHealth>(
      valueListenable: health,
      builder: (context, h, _) {
        if (!h.isDegraded) return const SizedBox.shrink();
        final dark = Theme.of(context).brightness == Brightness.dark;
        return Container(
          width: double.infinity,
          color: dark ? const Color(0xFF2A2118) : const Color(0xFFFFF3E0),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
          child: Text(
            '실시간 피드 불안정, 구독 유지 중 (자동 복구 대기, 누적 ${h.errorCount}회)',
            style: TextStyle(
              fontSize: 12,
              color: dark ? const Color(0xFFFFB340) : const Color(0xFFB26500),
            ),
          ),
        );
      },
    );
  }
}

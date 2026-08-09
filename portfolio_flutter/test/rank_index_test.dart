import 'dart:math';

import 'package:flutter_test/flutter_test.dart';
import 'package:jc_ticker/state/rank_index.dart';

/// RankIndex 순서 규약의 등가성 테스트.
///
/// RankIndex는 성능을 위해 종목코드 문자열 tiebreak를 "생성 시 1회 계산한 정수
/// 순위"로 대체한다 (PERF.md §6-3). 그 치환이 순서를 바꾸지 않는다는 것은 눈으로
/// 확인할 성질이 아니라 오라클로 못박을 성질이다. 여기서 오라클은 **문자열 비교로
/// 매번 전체 정렬한 결과**이며, 다음 두 축으로 검증한다.
///
/// 1. 코드 배열 순서 != 코드 사전순인 경우 (정수 tiebreak가 index가 아니라
///    코드 순위를 따르는지 - 이 구분이 깨지면 정렬 순서가 조용히 달라진다)
/// 2. 무작위 갱신열 fuzz (동률이 대량으로 발생하는 조건 포함)
List<int> bruteForceOrder(List<String> codes, List<double> rates, int k) {
  final order = List<int>.generate(codes.length, (i) => i)
    ..sort((a, b) {
      final byRate = rates[b].compareTo(rates[a]);
      if (byRate != 0) return byRate;
      return codes[a].compareTo(codes[b]);
    });
  return order.take(k).toList();
}

void main() {
  test('코드 배열이 사전순으로 들어오지 않아도 tiebreak는 코드 오름차순이다', () {
    // 입력 순서(index)와 코드 사전순이 서로 다르다.
    final codes = ['000900', '000100', '000500', '000300'];
    final rank = RankIndex(codes);
    for (var i = 0; i < codes.length; i++) {
      rank.update(i, 5); // 전부 동률
    }
    expect(
      rank.top(4).map((i) => codes[i]).toList(),
      ['000100', '000300', '000500', '000900'],
      reason: 'index 순서가 아니라 코드 오름차순이어야 한다',
    );
  });

  test('등락률 우선, 동률일 때만 코드 - 브루트포스 전체 정렬과 일치', () {
    final codes = ['000900', '000100', '000500', '000300'];
    final rates = [10.0, 30.0, 30.0, -5.0];
    final rank = RankIndex(codes);
    for (var i = 0; i < codes.length; i++) {
      rank.update(i, rates[i]);
    }
    expect(rank.top(4), bruteForceOrder(codes, rates, 4));
    expect(rank.top(4).map((i) => codes[i]).toList(), [
      '000100',
      '000500',
      '000900',
      '000300',
    ]);
  });

  test('무작위 갱신 fuzz: 항상 브루트포스 전체 정렬과 같은 Top-20', () {
    const n = 300;
    final random = Random(20260810); // 결정론 고정
    // 코드는 사전순과 index 순서가 어긋나도록 뒤섞어 만든다.
    final codes = <String>[
      for (var i = 0; i < n; i++)
        ((i * 137 + 11) % 1000).toString().padLeft(6, '0'),
    ];
    final rank = RankIndex(codes);
    final rates = List<double>.filled(n, 0);

    for (var step = 0; step < 3000; step++) {
      final i = random.nextInt(n);
      // 동률을 대량으로 만들기 위해 값 domain을 좁게 잡는다 (clamp 고착 재현).
      final r = (random.nextInt(9) - 4) * 7.5;
      rates[i] = r;
      rank.update(i, r);

      if (step % 250 == 0) {
        expect(
          rank.top(20),
          bruteForceOrder(codes, rates, 20),
          reason: 'step $step에서 증분 순위가 전체 정렬과 어긋남',
        );
      }
    }
    expect(rank.top(20), bruteForceOrder(codes, rates, 20));
  });

  test('같은 값으로 재갱신해도 순서가 흔들리지 않는다', () {
    final codes = ['000002', '000001', '000003'];
    final rank = RankIndex(codes);
    for (var i = 0; i < codes.length; i++) {
      rank.update(i, 30);
    }
    final before = rank.top(3);
    for (var i = 0; i < codes.length; i++) {
      rank.update(i, 30);
    }
    expect(rank.top(3), before, reason: '동률 재갱신은 rank thrashing을 만들면 안 됨');
  });
}

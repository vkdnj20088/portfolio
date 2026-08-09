import 'dart:collection';

/// 등락률 순위를 **증분(O(log n)/갱신)** 으로 유지하는 인덱스.
///
/// (등락률 내림차순, 종목코드 오름차순)의 전순서(total order)를 SplayTreeSet으로
/// 유지한다. tick 하나가 바꾸는 것은 종목 하나의 등락률뿐이므로, 그 종목만
/// 제거->갱신->재삽입하면 전체 순서가 보존된다. 매 tick 전체 재정렬(O(n log n))을
/// 하지 않으며, Top-20 조회는 트리 앞쪽 20개 순회로 끝난다.
///
/// tiebreak: clamp(±30%)로 등락률이 정확히 같아지는 종목이 여럿 생긴다.
/// Dart의 `List.sort`는 unstable이라 동률의 표시 순서가 매 갱신 흔들릴 수 있으므로
/// (rank thrashing), 종목코드를 2차 정렬키로 두어 순서를 결정적으로 고정한다.
///
/// 비교자는 이 앱에서 가장 뜨거운 코드다 - 갱신 1회가 SplayTreeSet의 제거/삽입
/// 경로에서 O(log n)회, 초당 수만 번 호출된다 (PERF.md §2의 분해 기준 적용 비용의
/// 약 80%). 그래서 코드 문자열 비교를 **생성 시 1회 계산한 정수 순위**로 대체했다:
/// `_codeOrder[i]`는 종목코드 오름차순에서 i가 놓이는 위치이므로 정수 뺄셈 한 번이
/// 문자열 비교와 같은 순서를 만든다. 등락률도 `compareTo` 대신 원시 비교를 쓴다
/// (등락률은 항상 유한값이다 - 스토어가 previousClose == 0을 0.0으로 막는다).
class RankIndex {
  RankIndex(List<String> codes)
    : _rates = List<double>.filled(codes.length, 0),
      _codeOrder = List<int>.filled(codes.length, 0) {
    final ascending = List<int>.generate(codes.length, (i) => i)
      ..sort((a, b) => codes[a].compareTo(codes[b]));
    for (var pos = 0; pos < ascending.length; pos++) {
      _codeOrder[ascending[pos]] = pos;
    }
    _tree = SplayTreeSet<int>(_compare);
    for (var i = 0; i < codes.length; i++) {
      _tree.add(i);
    }
  }

  final List<double> _rates;

  /// 종목코드 오름차순에서의 위치. 문자열 tiebreak를 정수 tiebreak로 바꾼다.
  final List<int> _codeOrder;

  late final SplayTreeSet<int> _tree;

  int _compare(int a, int b) {
    if (a == b) return 0;
    final ra = _rates[a];
    final rb = _rates[b];
    if (ra > rb) return -1; // 등락률 내림차순
    if (ra < rb) return 1;
    return _codeOrder[a] - _codeOrder[b]; // 결정적 tiebreak (코드 오름차순과 동일)
  }

  double rateOf(int index) => _rates[index];

  /// [index]의 등락률을 갱신한다.
  ///
  /// 주의: 트리는 comparator가 [_rates]를 읽으므로, 반드시 **기존 rate가 남아있는
  /// 상태에서 제거**한 뒤 값을 바꾸고 재삽입해야 한다. 순서를 어기면 트리가 깨진다.
  /// 이 규칙을 강제하기 위해 [_rates]는 이 클래스가 소유한다.
  void update(int index, double newRate) {
    if (_rates[index] == newRate) return;
    _tree.remove(index);
    _rates[index] = newRate;
    _tree.add(index);
  }

  /// 상위 [k]개 종목 index (등락률 desc, 코드 asc).
  List<int> top(int k) {
    final out = <int>[];
    for (final i in _tree) {
      out.add(i);
      if (out.length >= k) break;
    }
    return out;
  }
}

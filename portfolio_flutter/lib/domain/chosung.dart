/// 한글 초성 추출/매칭 유틸.
///
/// 라이브러리 대신 직접 구현한 이유(DESIGN.md §5): 필요한 것은 유니코드 산술
/// 몇 줄뿐이고(한글 음절 = 0xAC00 + 초성x588 + 중성x28 + 종성), 외부 의존성을
/// 늘리는 것보다 검색 핫패스를 전부 검증/설명 가능한 코드로 유지하는 쪽이
/// 이 데모의 성격(외부 패키지 0개, 전 구간 설명 가능)에 맞다.
library;

/// 초성 19자 - 유니코드 한글 음절 분해 순서 그대로.
const List<String> _choseong = [
  'ㄱ',
  'ㄲ',
  'ㄴ',
  'ㄷ',
  'ㄸ',
  'ㄹ',
  'ㅁ',
  'ㅂ',
  'ㅃ',
  'ㅅ',
  'ㅆ',
  'ㅇ',
  'ㅈ',
  'ㅉ',
  'ㅊ',
  'ㅋ',
  'ㅌ',
  'ㅍ',
  'ㅎ',
];

const int _hangulBase = 0xAC00; // '가'
const int _hangulLast = 0xD7A3; // '힣'
const int _jamoConsonantFirst = 0x3131; // 'ㄱ' (호환 자모)
const int _jamoConsonantLast = 0x314E; // 'ㅎ'

/// 문자열의 각 한글 음절을 초성으로 치환한 문자열을 돌려준다.
/// 예: '가온전자' -> 'ㄱㅇㅈㅈ'. 한글이 아닌 문자는 그대로 둔다.
String extractChosung(String text) {
  final buffer = StringBuffer();
  for (final rune in text.runes) {
    if (rune >= _hangulBase && rune <= _hangulLast) {
      buffer.write(_choseong[(rune - _hangulBase) ~/ 588]);
    } else {
      buffer.writeCharCode(rune);
    }
  }
  return buffer.toString();
}

/// 질의가 순수 초성(자음 자모)로만 이루어졌는지.
bool isChosungQuery(String query) {
  if (query.isEmpty) return false;
  for (final rune in query.runes) {
    if (rune < _jamoConsonantFirst || rune > _jamoConsonantLast) return false;
  }
  return true;
}

/// 한 종목이 질의에 매칭되는지 판정한다.
///
/// 규칙(부분일치, DESIGN.md §5):
/// - 종목명 부분일치 (예: '전자')
/// - 종목코드 부분일치 (예: '000590')
/// - 질의가 순수 초성이면 초성열 부분일치 (예: 'ㄱㅇ' -> '가온...')
bool matchesSymbol({
  required String name,
  required String code,
  required String chosung,
  required String query,
}) {
  if (query.isEmpty) return true;
  if (name.contains(query)) return true;
  if (code.contains(query)) return true;
  if (isChosungQuery(query) && chosung.contains(query)) return true;
  return false;
}

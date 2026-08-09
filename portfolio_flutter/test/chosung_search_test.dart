import 'package:flutter_test/flutter_test.dart';
import 'package:jc_ticker/domain/chosung.dart';
import 'package:jc_ticker/feed/market_feed.dart';
import 'package:jc_ticker/state/search_model.dart';

/// 초성 추출/매칭과 검색 모델 테스트 (대표 케이스 포함).
void main() {
  group('extractChosung', () {
    test('한글 음절을 초성으로 치환한다', () {
      expect(extractChosung('한빛전자'), 'ㅎㅂㅈㅈ');
      expect(extractChosung('두레화학'), 'ㄷㄹㅎㅎ');
      expect(extractChosung('두레시스템'), 'ㄷㄹㅅㅅㅌ');
    });

    test('한글이 아닌 문자는 그대로 둔다', () {
      expect(extractChosung('한빛A1'), 'ㅎㅂA1');
    });
  });

  group('isChosungQuery', () {
    test('순수 자음 자모만 true', () {
      expect(isChosungQuery('ㅎㅂ'), isTrue);
      expect(isChosungQuery('ㄷㄹㅎㅎ'), isTrue);
      expect(isChosungQuery('한빛'), isFalse);
      expect(isChosungQuery('ㅎ전'), isFalse);
      expect(isChosungQuery('000590'), isFalse);
      expect(isChosungQuery(''), isFalse);
    });
  });

  group('matchesSymbol (대표 예시)', () {
    const name1 = '한빛전자';
    const name2 = '두레화학';

    test('초성 검색: ㅎㅂ -> 한빛..., ㄷㄹㅎㅎ -> 두레화학, ㅎㅂㅈㅈ -> 한빛전자', () {
      expect(
        matchesSymbol(
          name: name1,
          code: '000001',
          chosung: extractChosung(name1),
          query: 'ㅎㅂ',
        ),
        isTrue,
      );
      expect(
        matchesSymbol(
          name: name2,
          code: '000002',
          chosung: extractChosung(name2),
          query: 'ㄷㄹㅎㅎ',
        ),
        isTrue,
      );
      expect(
        matchesSymbol(
          name: name1,
          code: '000001',
          chosung: extractChosung(name1),
          query: 'ㅎㅂㅈㅈ',
        ),
        isTrue,
      );
      expect(
        matchesSymbol(
          name: name2,
          code: '000002',
          chosung: extractChosung(name2),
          query: 'ㅎㅂㅈㅈ',
        ),
        isFalse,
      );
    });

    test('완성형 부분일치와 코드 부분일치도 지원한다', () {
      expect(
        matchesSymbol(
          name: name1,
          code: '000001',
          chosung: extractChosung(name1),
          query: '전자',
        ),
        isTrue,
      );
      expect(
        matchesSymbol(
          name: name2,
          code: '000590',
          chosung: extractChosung(name2),
          query: '000590',
        ),
        isTrue,
      );
      expect(
        matchesSymbol(
          name: name2,
          code: '000590',
          chosung: extractChosung(name2),
          query: '전자',
        ),
        isFalse,
      );
    });
  });

  group('SearchModel', () {
    test('실제 2,000종목 universe에서 초성/이름/코드 필터가 동작한다', () {
      final feed = MarketFeed();
      final search = SearchModel(feed.symbols, debounce: Duration.zero);

      expect(search.visibleIndices.length, 2000);

      search.setQuery('전자');
      expect(search.visibleIndices, isNotEmpty);
      expect(
        search.visibleIndices.every((i) => feed.symbols[i].name.contains('전자')),
        isTrue,
      );

      search.setQuery('ㄷㄹㅎㅎ');
      expect(search.visibleIndices, isNotEmpty);
      expect(
        search.visibleIndices.every(
          (i) => extractChosung(feed.symbols[i].name).contains('ㄷㄹㅎㅎ'),
        ),
        isTrue,
      );
      // '두레화학'이 포함되어야 한다.
      expect(
        search.visibleIndices.any((i) => feed.symbols[i].name == '두레화학'),
        isTrue,
      );

      search.setQuery('000590');
      expect(
        search.visibleIndices.map((i) => feed.symbols[i].code),
        contains('000590'),
      );

      search.setQuery('');
      expect(search.visibleIndices.length, 2000);

      search.dispose();
      feed.dispose();
    });

    test('필터 결과는 tick 유입과 무관하다 (정적 인덱스)', () async {
      // 검색 대상(이름/코드)은 불변이므로, tick이 아무리 흘러도 필터 결과가
      // 재계산되거나 바뀔 이유가 없다 - 설계 불변식의 회귀 테스트.
      final feed = MarketFeed(seed: 5);
      final search = SearchModel(feed.symbols, debounce: Duration.zero);
      search.setQuery('ㄱㅇ');
      final before = search.visibleIndices;

      feed.ticks.listen((_) {});
      feed.pump(100);
      await pumpEventQueue();

      expect(
        identical(search.visibleIndices, before),
        isTrue,
        reason: 'tick으로는 필터 재계산 자체가 일어나지 않아야 함',
      );

      search.dispose();
      feed.dispose();
    });

    test('debounce: 연속 입력은 마지막 질의만 1회 적용된다', () async {
      final feed = MarketFeed();
      final search = SearchModel(
        feed.symbols,
        debounce: const Duration(milliseconds: 50),
      );
      var notifications = 0;
      search.addListener(() => notifications++);

      search.setQuery('ㄱ');
      search.setQuery('ㄱㅇ');
      search.setQuery('ㄱㅇㅈ');
      expect(notifications, 0, reason: 'debounce 동안은 적용 안 됨');

      await Future<void>.delayed(const Duration(milliseconds: 80));
      expect(notifications, 1, reason: '마지막 질의만 1회 적용');
      expect(search.query, 'ㄱㅇㅈ');

      search.dispose();
      feed.dispose();
    });
  });
}

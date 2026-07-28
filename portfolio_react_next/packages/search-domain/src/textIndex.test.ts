import { describe, it, expect } from 'vitest';
import { createIndex } from './textIndex';
import { search } from './retrieval';

/**
 * 엔진이 "코퍼스 전용"이 아니라 임의의 문서 집합에 붙는다는 것을 고정한다.
 * 이 성질이 깨지면 같은 엔진을 다른 앱(채팅 메시지 검색)에서 재사용할 수 없다.
 */
describe('createIndex (범용 색인)', () => {
  const docs = [
    { id: 'a', text: '회고 템플릿을 코드로 정리해 줄 수 있어?' },
    { id: 'b', text: '액션 아이템에 담당자와 기한을 붙이고 다음 회고에서 확인합니다.' },
    { id: 'c', text: '오늘 점심은 김치찌개를 먹었습니다.' },
  ];

  it('임의 문서 집합을 색인하고 관련 문서를 랭킹한다', () => {
    const index = createIndex(docs);
    expect(index.size).toBe(3);
    const hits = index.search('회고');
    expect(hits.length).toBe(2);
    expect(hits.map((h) => h.id).sort()).toEqual(['a', 'b']);
    expect(hits.every((h) => h.semantic > 0)).toBe(true);
  });

  it('조사가 붙어 저장된 말도 맨 명사 질의로 찾는다', () => {
    const index = createIndex([{ id: 'x', text: '커버리지를 올리는 방법' }]);
    expect(index.search('커버리지').map((h) => h.id)).toEqual(['x']);
  });

  it('인스턴스는 서로 독립이다(한쪽 어휘·통계가 다른 쪽에 새지 않는다)', () => {
    const a = createIndex(docs);
    const b = createIndex([{ id: 'z', text: '완전히 다른 문서' }]);
    expect(a.search('회고').length).toBe(2);
    expect(b.search('회고')).toEqual([]);
    expect(b.size).toBe(1);
  });

  it('빈 문서 집합도 안전하다', () => {
    const empty = createIndex([]);
    expect(empty.size).toBe(0);
    expect(empty.search('무엇이든')).toEqual([]);
  });

  it('동의어 사전을 주입하지 않으면 확장이 없다(모드 차이가 사라진다)', () => {
    const plain = createIndex([{ id: 'p', text: '연차 유급휴가는 11일입니다.' }], { synonyms: {} });
    expect(plain.expansionsOf('휴가')).toEqual([]);
    expect(plain.search('휴가', 'semantic')).toEqual([]); // 확장이 없으니 못 찾는다
    const expanded = createIndex([{ id: 'p', text: '연차 유급휴가는 11일입니다.' }]);
    expect(expanded.search('휴가', 'semantic').length).toBe(1);
  });

  it('코퍼스 검색은 이 엔진 위에 얹힌 어댑터다(동작 동일)', () => {
    // retrieval.search 는 같은 엔진의 인스턴스를 쓰고 문단·문서 메타만 붙인다.
    const hits = search('연차', 'semantic');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.docTitle.length).toBeGreaterThan(0);
  });
});

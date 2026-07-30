import { describe, expect, it } from 'vitest';
import { evaluateFollowUp, validateFollowUpGoldset } from './followup';

/**
 * 후속질문 컨텍스트의 채택 판정(#D1)을 <b>테스트로 고정</b>한다.
 *
 * 이 파일이 검증하는 것은 기능이 아니라 결론이다. "문서 고정은 도움이 되고 질의어 확장은
 * 해가 된다"는 판정이 코퍼스·랭킹 변경으로 뒤집히면 여기서 실패해야 한다 - 그때는 결론을
 * 다시 쓰거나 구현을 바꿔야 하고, 조용히 지나가면 안 된다.
 */
describe('후속질문 컨텍스트 - 측정으로 채택/미채택을 가른다', () => {
  it('골드셋 라벨이 실제 코퍼스를 가리킨다', () => {
    expect(validateFollowUpGoldset()).toEqual([]);
  });

  it('문서 고정은 정확도를 올린다 -> 채택', () => {
    const r = evaluateFollowUp();
    expect(r.docPinOnly.recall1).toBeGreaterThan(r.withoutContext.recall1);
    expect(r.docPinOnly.mrr).toBeGreaterThan(r.withoutContext.mrr);
  });

  it('직전 질의어 확장은 정확도를 떨어뜨린다 -> 미채택(제품 경로에서 쓰지 않음)', () => {
    const r = evaluateFollowUp();
    expect(r.queryExpansionOnly.recall1).toBeLessThan(r.withoutContext.recall1);
    expect(r.queryExpansionOnly.mrr).toBeLessThan(r.withoutContext.mrr);
  });

  it('둘을 합치면 확장의 해가 고정의 이득을 덮는다 - 합쳐 재면 상쇄가 안 보인다', () => {
    const r = evaluateFollowUp();
    expect(r.full.recall1).toBeLessThan(r.docPinOnly.recall1);
  });
});

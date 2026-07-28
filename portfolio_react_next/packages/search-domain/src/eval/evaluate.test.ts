import { describe, it, expect } from 'vitest';
import { evaluate } from './evaluate';
import { GOLDSET } from './goldset';

/**
 * 품질 회귀 게이트. 검색·독해를 손볼 때마다 "느낌상 좋아졌다"가 아니라 이 표가 판정한다.
 * 기준선은 현재 실측값보다 살짝 아래로 잡아, 노이즈가 아니라 진짜 퇴행일 때만 깨지게 했다.
 */
describe('품질 기준선(골드셋 33문항)', () => {
  const report = evaluate();

  it('불응답: 코퍼스에 답이 없으면 100% 침묵한다(지어내지 않는다)', () => {
    // 이 데모의 존재 이유. 한 건이라도 지어내면 실패한다.
    expect(report.abstention.n).toBeGreaterThanOrEqual(8);
    expect(report.abstention.rate).toBe(1);
  });

  it('검색: 시맨틱이 키워드보다 모든 지표에서 낫다(동의어 확장의 값을 숫자로 증명)', () => {
    const { semantic, keyword } = report.retrieval;
    expect(semantic.recall1).toBeGreaterThanOrEqual(keyword.recall1);
    expect(semantic.recall3).toBeGreaterThanOrEqual(keyword.recall3);
    expect(semantic.mrr).toBeGreaterThan(keyword.mrr);
  });

  it('검색 기준선: 시맨틱 Recall@1 >= 0.80, Recall@5 = 1.0, MRR >= 0.88', () => {
    expect(report.retrieval.semantic.recall1).toBeGreaterThanOrEqual(0.8);
    expect(report.retrieval.semantic.recall5).toBe(1);
    expect(report.retrieval.semantic.mrr).toBeGreaterThanOrEqual(0.88);
  });

  it('독해 기준선: 답변 정확도 >= 0.64, 오답(틀린 근거로 답함) <= 3건', () => {
    expect(report.answer.accuracy).toBeGreaterThanOrEqual(0.64);
    const wrong = report.answer.answered - report.answer.correct;
    expect(wrong).toBeLessThanOrEqual(3);
  });

  it('골드셋은 세 갈래를 모두 갖는다(라벨 유실 방지)', () => {
    const splits = new Set(GOLDSET.map((c) => c.split));
    expect([...splits].sort()).toEqual(['exact', 'paraphrase', 'unanswerable']);
    expect(GOLDSET.length).toBe(report.cases);
  });
});

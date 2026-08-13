import { type Variant, digest, toolsetDigest } from '@chat/agent-core';
import { TOOLS } from '../tools';

/**
 * 비교할 구성 두 종.
 *
 * 축을 시스템 프롬프트로 고른 이유는 셋이다. 같은 모델이라 비용이 가장 싸고, 변경이 한
 * 문장이라 "무엇이 달라졌나"가 명확하며, 이 포트폴리오의 다른 데모와 서사가 이어진다 -
 * DocuQA 대조군에서 "프롬프트를 유리하게도 불리하게도 기울이지 않았다"고 적었는데,
 * 여기서는 그 기울임이 결과를 얼마나 바꾸는지 직접 잰다.
 *
 * 프롬프트 원문의 진실원은 이 파일이다. 산출물에는 해시만 실어 "그때 무엇으로 돌렸나"를
 * 증언하게 한다. 원문을 양쪽에 두면 한쪽만 고치는 사고가 난다.
 */

const SHARED = [
  '당신은 JC 포트폴리오 데모의 사내 운영 보조입니다. 주어진 도구로만 사실을 확인하고,',
  '도구가 돌려준 것 밖의 내용을 지어내지 않습니다.',
  '코퍼스에 과제의 근거가 전혀 없으면 추측하지 말고, 답의 첫 줄에 NO_GROUNDS 만 쓴 뒤',
  '다음 줄부터 왜 찾지 못했는지 한 문장으로 적습니다. 근거를 하나라도 찾았다면 이 표시를',
  '쓰지 않습니다.',
  '답에는 근거가 된 문단 id 를 함께 적습니다. 한국어 존댓말로 간결하게 씁니다.',
].join(' ');

/** 1단계에서 쓰던 프롬프트 그대로. 기준선이므로 손대지 않는다. */
export const PROMPT_A = SHARED;

/**
 * 불응답을 한 문장으로 강화한 것. 기대하는 그림은 침묵이 늘고 정답도 함께 주는
 * 트레이드오프이고, 그건 DocuQA 임계값 스윕과 같은 종류의 곡선이다. 예상이 빗나가면
 * 빗나간 대로 적는다 - 예상에 맞는 결과만 싣는 실험은 실험이 아니다.
 */
export const PROMPT_B =
  SHARED + ' 확신이 서지 않으면 답하지 말고 근거를 찾지 못했다고 말하는 편을 택합니다.';

export const PROMPT_BY_VARIANT: Record<string, string> = { A: PROMPT_A, B: PROMPT_B };

export function variants(): Variant[] {
  const td = toolsetDigest(TOOLS);
  return [
    {
      id: 'A',
      label: '기본 프롬프트',
      note: '1단계에서 쓰던 지시 그대로',
      systemPromptDigest: digest(PROMPT_A),
      toolsetDigest: td,
      guardrails: [],
    },
    {
      id: 'B',
      label: '불응답 강화',
      note: '"확신이 서지 않으면 답하지 말라"는 한 문장을 더한 것',
      systemPromptDigest: digest(PROMPT_B),
      toolsetDigest: td,
      guardrails: [],
    },
  ];
}

export const VARIANTS = variants();

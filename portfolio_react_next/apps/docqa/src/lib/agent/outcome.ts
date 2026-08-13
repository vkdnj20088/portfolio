/**
 * 실행이 "근거 없음으로 끝난 것"인지 판정한다.
 *
 * 처음에는 최종 답에 "근거를 찾지 못했습니다"가 들어 있는지로 판정했다. 30 실행을 수집해
 * 보니 그 규칙이 **네 건을 뒤집어 놓았다.** 판정과 절차를 근거 문단까지 달아 제대로 답한
 * 실행들이, 끝에 "이 부분은 코퍼스에서 찾지 못했습니다" 같은 단서를 한 줄 붙였다는 이유로
 * 근거 없음으로 분류됐다. 반대로 표현을 바꿔 거절한 실행("...코퍼스에 없습니다")은 성공으로
 * 샜다.
 *
 * 최종 상태는 2단계 실험의 **결과 변수 그 자체**다. 그것을 산문에서 정규식으로 추측하면,
 * 그 위에 세운 통계가 아무리 정밀해도 재는 대상이 틀린다. 그래서 추측을 그만두고 계약을
 * 토큰으로 만들었다 - 근거가 없으면 첫 줄에 `NO_GROUNDS` 만 쓰라고 지시하고, 하네스는
 * 그 한 줄만 본다. 화면에 나갈 요약에서는 그 줄을 걷어낸다(사람에게는 기계 토큰이 아니라
 * 이유가 보여야 한다).
 *
 * 문장을 늘려 규칙을 정교하게 만드는 길도 있었지만, 그건 같은 종류의 추측을 조금 더 오래
 * 미루는 것뿐이다. 모델이 표현을 바꾸는 순간 다시 깨진다.
 */
export const NO_GROUNDS = 'NO_GROUNDS';

export interface Outcome {
  refused: boolean;
  /** 화면과 채점이 읽는 답. 센티널 줄은 빠져 있다. */
  summary: string;
}

export function classifyOutcome(text: string): Outcome {
  const trimmed = text.trim();
  // 첫 줄이 정확히 센티널일 때만 거절이다. 본문 어디에 등장하든 상관없게 두면
  // "NO_GROUNDS 라고 답하지 않았습니다" 같은 문장에 걸린다.
  const [first, ...rest] = trimmed.split('\n');
  if (first?.trim() !== NO_GROUNDS) return { refused: false, summary: trimmed };
  const body = rest.join('\n').trim();
  return {
    refused: true,
    summary: body || '사내문서에서 근거를 찾지 못했습니다.',
  };
}

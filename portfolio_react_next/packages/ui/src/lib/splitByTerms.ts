/**
 * 텍스트를 매칭 어휘 기준으로 조각낸다(검색 결과 하이라이트의 공통 부품).
 *
 * 두 앱(문서 QA, 채팅 대화 검색)이 같은 하이라이트를 그리는데, 까다로운 부분은 렌더가 아니라
 * 여기다: 정규식 메타문자 이스케이프, 긴 항목 우선 매칭, 대소문자 무시, 조각 경계. 그 부분만
 * 공유하고 <mark> 의 모양(클래스·토큰)은 각 앱이 자기 스타일로 그린다 - 로직은 하나, 표현은 각자.
 */
export interface TextSegment {
  text: string;
  /** 이 조각이 매칭된 부분인가(= <mark> 로 감쌀 대상). */
  match: boolean;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function splitByTerms(text: string, terms: string[]): TextSegment[] {
  const uniq = [...new Set(terms.filter((t) => t.length > 0))];
  if (uniq.length === 0) return [{ text, match: false }];
  // 긴 항목부터 매칭해 부분 겹침을 안정화한다("연차" 와 "연차휴가" 가 함께 오는 경우).
  const pattern = uniq
    .sort((a, b) => b.length - a.length)
    .map(escapeRe)
    .join('|');
  // 캡처 그룹으로 split 하면 홀수 인덱스가 매칭 조각이 된다(중첩 그룹이 없어 ReDoS 표면도 없다).
  const parts = text.split(new RegExp(`(${pattern})`, 'gi'));
  // 빈 조각 제거는 반드시 판정 "후"에 한다. 먼저 걸러내면 홀짝이 밀려 매칭 여부가 통째로 뒤집힌다
  // (매칭이 맨 앞이거나 연속으로 붙는 흔한 경우에 바로 터진다).
  return parts
    .map((part, index) => ({ text: part, match: index % 2 === 1 }))
    .filter((segment) => segment.text.length > 0);
}

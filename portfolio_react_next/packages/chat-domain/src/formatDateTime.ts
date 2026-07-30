/**
 * 명세 규칙: "모든 시간은 YYYY-MM-DD HH:mm Format 으로 표기합니다."
 *
 * 사이드바의 마지막 대화 시간과 말풍선 시간이 모두 이 함수 하나를 쓴다 -
 * 포맷터가 흩어지면 "모든 시간" 이라는 요구가 화면마다 어긋나기 시작한다.
 * Intl.DateTimeFormat 은 이 고정 포맷을 만들기에 오히려 돌아가는 길이라 수동 패딩으로 충분하다.
 *
 * <b>기준 시간대는 KST(UTC+9) 고정</b>이다. 직전까지는 기기 지역 시간을 썼는데, 그러면 같은
 * 대화가 보는 사람의 시간대에 따라 다른 시각으로 읽힌다. 이 포트폴리오의 모든 데모가 KST 를
 * 기준으로 표기하도록 통일했다(인트로의 경력 계산도 같은 기준이다).
 *
 * 고정 오프셋으로 더하는 이유: 대한민국은 서머타임이 없어 UTC+9 가 상시 정확하다.
 * epoch 에 9시간을 더하고 getUTC* 로 읽으면 실행 환경 TZ 와 무관하게 KST 벽시계가 나온다.
 */
export const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function formatDateTime(epochMs: number): string {
  const d = new Date(epochMs + KST_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

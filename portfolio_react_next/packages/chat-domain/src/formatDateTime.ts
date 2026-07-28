/**
 * 명세 규칙: "모든 시간은 YYYY-MM-DD HH:mm Format 으로 표기합니다."
 *
 * 사이드바의 마지막 대화 시간과 말풍선 시간이 모두 이 함수 하나를 쓴다 -
 * 포맷터가 흩어지면 "모든 시간" 이라는 요구가 화면마다 어긋나기 시작한다.
 * Intl.DateTimeFormat 은 이 고정 포맷을 만들기에 오히려 돌아가는 길이라 수동 패딩으로 충분하다.
 */
export function formatDateTime(epochMs: number): string {
  const d = new Date(epochMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

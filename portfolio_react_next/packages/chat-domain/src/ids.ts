/**
 * id 생성기.
 *
 * crypto.randomUUID() 를 쓰지 않는 이유: Chrome 92+ 라 지원 하한(88)을 넘고,
 * secure context 전용이라 http 환경에서도 죽는다(저장소 ESLint 금지 규칙에도 걸린다).
 * 시각 프리픽스는 디버깅 시 생성 시점을 눈으로 유추하는 용도일 뿐, id 사전순은 계약이
 * 아니다 - 같은 ms 안에서는 seq 자리수 변동으로 생성순과 어긋날 수 있고, 실제 정렬은
 * 전부 createdAt 이 담당한다. 탭 간 충돌 회피(난수 서픽스)면 이 서비스엔 충분하다.
 */
let counter = 0;

export function createId(prefix: string): string {
  const time = Date.now().toString(36);
  const seq = (counter++).toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `${prefix}_${time}${seq}${rand}`;
}

/**
 * id 생성기.
 *
 * crypto.randomUUID() 를 쓰지 않는 이유: secure context 전용이라 http 로 열면 죽는다.
 * (지원 하한이 Chrome 88 이던 시절에는 92+ 라는 이유도 있었으나 하한이 111 로 올라가
 * 그 근거는 사라졌다 - 남은 것은 secure context 제약 하나다.)
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

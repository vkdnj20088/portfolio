/**
 * 조건부 className 결합기.
 *
 * clsx 를 넣지 않고 직접 두는 이유: 필요한 기능이 이게 전부이고,
 * 디자인 시스템 패키지의 의존성은 모든 앱으로 전파되므로 가볍게 유지할 가치가 있다.
 */
export type ClassValue = string | number | null | undefined | false | ClassValue[];

export function cn(...values: ClassValue[]): string {
  const out: string[] = [];

  for (const value of values) {
    if (!value && value !== 0) continue;
    if (Array.isArray(value)) {
      const nested = cn(...value);
      if (nested) out.push(nested);
    } else {
      out.push(String(value));
    }
  }

  return out.join(' ');
}

/**
 * 영속 계층 추상화.
 *
 * localStorage 를 직접 부르지 않고 최소 인터페이스 뒤에 두는 이유:
 *  - 테스트가 브라우저(jsdom) 없이 돈다 - 메모리 구현을 주입하면 끝.
 *  - SSR 안전: 서버에는 window 가 없으므로 자동으로 메모리 구현이 선택된다
 *    (mock 은 클라이언트 전용이지만, 실수로 서버에서 import 돼도 크래시 대신 빈 상태).
 *  - 추후 실서버 API 로 갈 때 이 계층만 사라지면 된다.
 */
export interface KVStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export function createMemoryStorage(): KVStorage {
  const map = new Map<string, string>();
  return {
    get: (key) => map.get(key) ?? null,
    set: (key, value) => {
      map.set(key, value);
    },
  };
}

export function createBrowserStorage(): KVStorage {
  return {
    get: (key) => window.localStorage.getItem(key),
    set: (key, value) => {
      window.localStorage.setItem(key, value);
    },
  };
}

export function createDefaultStorage(): KVStorage {
  return typeof window === 'undefined' ? createMemoryStorage() : createBrowserStorage();
}

import { afterEach, describe, expect, it, vi } from 'vitest';
import { portfolioHomeHref } from './portfolioHome';

/** window.location 을 원하는 주소로 바꿔 놓고 함수를 부른다. */
function at(href: string): string {
  vi.stubGlobal('window', { location: new URL(href) });
  return portfolioHomeHref('/fallback');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('portfolioHomeHref', () => {
  it('도메인 배포: 앱 서브도메인의 첫 라벨을 떼어 인트로(apex)로 보낸다', () => {
    expect(at('https://chat.example.dev/')).toBe('https://example.dev/');
    expect(at('https://docqa.example.dev/search')).toBe('https://example.dev/');
    expect(at('https://guard.example.dev/ip.html')).toBe('https://example.dev/');
  });

  it('다단계 ccTLD 에서도 첫 라벨만 뗀다', () => {
    expect(at('https://chat.example.co.kr/')).toBe('https://example.co.kr/');
  });

  it('IP 배포: 포트를 떼고 같은 IP 의 443 으로 보낸다', () => {
    // 데모는 포트로 갈리지만(9443 등) 인트로는 443 이라 포트 표기가 없어야 한다.
    expect(at('https://3.36.172.157:9443/')).toBe('https://3.36.172.157/');
    expect(at('https://3.36.172.157:8443/ip.html')).toBe('https://3.36.172.157/');
  });

  it('로컬 개발에서는 인트로 위치를 알 수 없으므로 기본값을 그대로 쓴다', () => {
    expect(at('http://localhost:3000/')).toBe('/fallback');
    expect(at('http://127.0.0.1:3030/search')).toBe('/fallback');
  });

  it('이미 apex 라면 뗄 라벨이 없다', () => {
    expect(at('https://example.dev/')).toBe('https://example.dev/');
  });

  it('서버 렌더(window 없음)에서는 기본값을 돌려준다', () => {
    vi.stubGlobal('window', undefined);
    expect(portfolioHomeHref('/fallback')).toBe('/fallback');
  });
});

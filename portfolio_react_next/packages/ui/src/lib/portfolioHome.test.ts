import { afterEach, describe, expect, it, vi } from 'vitest';
import { portfolioHomeHref } from './portfolioHome';

/** window.location 을 원하는 주소로 바꿔 놓고 함수를 부른다. */
function at(href: string, from?: string): string {
  vi.stubGlobal('window', { location: new URL(href) });
  return portfolioHomeHref('/fallback', from);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('portfolioHomeHref', () => {
  it('도메인 배포: 앱 서브도메인의 첫 라벨을 떼어 인트로(apex)로 보낸다', () => {
    expect(at('https://chat.example.dev/')).toBe('https://example.dev/#demos');
    expect(at('https://docqa.example.dev/search')).toBe('https://example.dev/#demos');
    expect(at('https://guard.example.dev/ip.html')).toBe('https://example.dev/#demos');
  });

  it('다단계 ccTLD 에서도 첫 라벨만 뗀다', () => {
    expect(at('https://chat.example.co.kr/')).toBe('https://example.co.kr/#demos');
  });

  it('IP 배포: 포트를 떼고 같은 IP 의 443 으로 보낸다', () => {
    // 데모는 포트로 갈리지만(9443 등) 인트로는 443 이라 포트 표기가 없어야 한다.
    expect(at('https://3.36.172.157:9443/')).toBe('https://3.36.172.157/#demos');
    expect(at('https://3.36.172.157:8443/ip.html')).toBe('https://3.36.172.157/#demos');
  });

  // 인트로는 자기소개까지 담은 긴 한 장이라, 루트로 보내면 데모 목록이 2,441px 아래에 있다.
  // 데모를 보고 나온 사람이 다시 스크롤하지 않도록 목록에 바로 착지시킨다.
  it('목적지는 인트로 최상단이 아니라 데모 목록이다', () => {
    expect(at('https://chat.example.dev/').endsWith('#demos')).toBe(true);
  });

  it('from 을 주면 쿼리로 싣는다 - 인트로가 그 카드에 표식을 단다', () => {
    expect(at('https://chat.example.dev/', 'chat')).toBe('https://example.dev/?from=chat#demos');
    // 앵커는 쿼리 뒤에 온다(순서가 뒤집히면 from 이 프래그먼트의 일부가 된다).
    expect(at('https://3.36.172.157:9444/search', 'docqa-search')).toBe(
      'https://3.36.172.157/?from=docqa-search#demos',
    );
  });

  it('로컬 개발에서는 인트로 위치를 알 수 없으므로 기본값을 그대로 쓴다', () => {
    // 앵커도 from 도 붙이지 않는다 - 붙일 근거가 없는 주소다.
    expect(at('http://localhost:3000/')).toBe('/fallback');
    expect(at('http://127.0.0.1:3030/search', 'docqa-search')).toBe('/fallback');
  });

  it('이미 apex 라면 뗄 라벨이 없다', () => {
    expect(at('https://example.dev/')).toBe('https://example.dev/#demos');
  });

  it('서버 렌더(window 없음)에서는 기본값을 돌려준다', () => {
    vi.stubGlobal('window', undefined);
    expect(portfolioHomeHref('/fallback', 'chat')).toBe('/fallback');
  });
});

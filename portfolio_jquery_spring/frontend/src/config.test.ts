import { describe, expect, it } from 'vitest';
import { resolvePortfolioHome } from './config';

// 이 버튼은 "인트로로 돌아가기"다. 예전엔 상수 '/' 라 이 앱의 루트(파일 차단 화면)로 갔다 -
// ip.html 에서 누르면 다른 데모로 튀었다. 아래가 그 회귀를 막는다.
describe('resolvePortfolioHome - 복귀 버튼 목적지', () => {
  it('도메인 배포: 서브도메인 첫 라벨을 떼어 인트로(apex)로 보낸다', () => {
    expect(resolvePortfolioHome('ip.example.dev', 'https:')).toBe('https://example.dev/');
    expect(resolvePortfolioHome('file.example.dev', 'https:')).toBe('https://example.dev/');
    expect(resolvePortfolioHome('guard.example.dev', 'https:')).toBe('https://example.dev/');
  });

  it('다단계 ccTLD 에서도 첫 라벨만 뗀다', () => {
    expect(resolvePortfolioHome('ip.example.co.kr', 'https:')).toBe('https://example.co.kr/');
  });

  it('포트 배포: 포트를 떼고 같은 IP 의 443 으로 보낸다', () => {
    // 이 앱은 :8443 에 살고 인트로는 :443 에 있다. 포트를 남기면 자기 자신으로 돌아온다.
    expect(resolvePortfolioHome('3.36.172.157', 'https:')).toBe('https://3.36.172.157/');
  });

  it('로컬/파일 실행에서는 인트로 위치를 알 수 없어 기본값을 쓴다', () => {
    expect(resolvePortfolioHome('localhost', 'http:')).toBe('/');
    expect(resolvePortfolioHome('127.0.0.1', 'http:')).toBe('/');
    expect(resolvePortfolioHome('example.dev', 'file:')).toBe('/');
  });

  it('이미 apex 라면 뗄 라벨이 없다', () => {
    expect(resolvePortfolioHome('example.dev', 'https:')).toBe('https://example.dev/');
  });
});

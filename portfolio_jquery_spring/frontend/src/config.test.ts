import { describe, expect, it } from 'vitest';
import { resolvePortfolioHome, resolveSiblingScreen } from './config';

// 이 버튼은 "인트로로 돌아가기"다. 예전엔 상수 '/' 라 이 앱의 루트(파일 차단 화면)로 갔다 -
// ip.html 에서 누르면 다른 데모로 튀었다. 아래가 그 회귀를 막는다.
describe('resolvePortfolioHome - 복귀 버튼 목적지', () => {
  it('도메인 배포: 서브도메인 첫 라벨을 떼어 인트로(apex)로 보낸다', () => {
    expect(resolvePortfolioHome('ip.example.dev', 'https:')).toBe('https://example.dev/#demos');
    expect(resolvePortfolioHome('file.example.dev', 'https:')).toBe('https://example.dev/#demos');
    expect(resolvePortfolioHome('guard.example.dev', 'https:')).toBe('https://example.dev/#demos');
  });

  it('다단계 ccTLD 에서도 첫 라벨만 뗀다', () => {
    expect(resolvePortfolioHome('ip.example.co.kr', 'https:')).toBe('https://example.co.kr/#demos');
  });

  it('포트 배포: 포트를 떼고 같은 IP 의 443 으로 보낸다', () => {
    // 이 앱은 :8443 에 살고 인트로는 :443 에 있다. 포트를 남기면 자기 자신으로 돌아온다.
    expect(resolvePortfolioHome('3.36.172.157', 'https:')).toBe('https://3.36.172.157/#demos');
  });

  // 인트로는 자기소개까지 담은 긴 한 장이다. 루트로 보내면 데모 목록이 2,441px 아래에 있어
  // 다음 데모를 보려면 히어로와 About 을 다시 스크롤해야 했다.
  it('목적지는 인트로 최상단이 아니라 데모 목록이다', () => {
    expect(resolvePortfolioHome('ip.example.dev', 'https:').endsWith('#demos')).toBe(true);
  });

  it('from 을 주면 쿼리로 싣는다 - 인트로가 그 카드에 표식을 단다', () => {
    expect(resolvePortfolioHome('ip.example.dev', 'https:', 'ip')).toBe(
      'https://example.dev/?from=ip#demos',
    );
    // 앵커는 쿼리 뒤에 온다(순서가 뒤집히면 from 이 프래그먼트의 일부가 된다).
    expect(resolvePortfolioHome('3.36.172.157', 'https:', 'files')).toBe(
      'https://3.36.172.157/?from=files#demos',
    );
  });

  it('로컬/파일 실행에서는 인트로 위치를 알 수 없어 기본값을 쓴다', () => {
    // 앵커도 from 도 붙이지 않는다 - 붙일 근거가 없는 주소다.
    expect(resolvePortfolioHome('localhost', 'http:')).toBe('/');
    expect(resolvePortfolioHome('127.0.0.1', 'http:', 'ip')).toBe('/');
    expect(resolvePortfolioHome('example.dev', 'file:')).toBe('/');
  });

  it('이미 apex 라면 뗄 라벨이 없다', () => {
    expect(resolvePortfolioHome('example.dev', 'https:')).toBe('https://example.dev/#demos');
  });
});

// 두 화면은 한 애플리케이션이다. 배포 형태에 따라 "나머지 한 화면"의 주소가 달라진다.
describe('resolveSiblingScreen - 나머지 한 화면', () => {
  it('서브도메인 배포: 첫 라벨만 맞바꾼다', () => {
    expect(resolveSiblingScreen('file.example.dev', 'https://file.example.dev', 'files'))
      .toBe('https://ip.example.dev/');
    expect(resolveSiblingScreen('ip.example.dev', 'https://ip.example.dev', 'ip'))
      .toBe('https://file.example.dev/');
  });

  it('다단계 ccTLD 에서도 첫 라벨만 바꾼다', () => {
    expect(resolveSiblingScreen('ip.example.co.kr', 'https://ip.example.co.kr', 'ip'))
      .toBe('https://file.example.co.kr/');
  });

  it('IP 배포: 같은 출처의 다른 경로 - 포트를 잃지 않는다', () => {
    // 포트를 떨어뜨리면 :443 인 인트로로 가 버린다. 두 화면은 둘 다 :8443 에 있다.
    expect(resolveSiblingScreen('3.36.172.157', 'https://3.36.172.157:8443', 'files'))
      .toBe('https://3.36.172.157:8443/ip.html');
    expect(resolveSiblingScreen('3.36.172.157', 'https://3.36.172.157:8443', 'ip'))
      .toBe('https://3.36.172.157:8443/');
  });

  it('guard. 는 한 서브도메인이 두 화면을 다 서빙하므로 경로로 오간다', () => {
    expect(resolveSiblingScreen('guard.example.dev', 'https://guard.example.dev', 'files'))
      .toBe('https://guard.example.dev/ip.html');
  });

  it('로컬에서도 경로로 오간다', () => {
    expect(resolveSiblingScreen('localhost', 'http://localhost:8080', 'files'))
      .toBe('http://localhost:8080/ip.html');
  });
});

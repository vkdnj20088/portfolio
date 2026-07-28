import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { THEME_INIT } from './themeInit';
import { FOUC_SCRIPT_HASH } from '@/middleware';

/**
 * CSP 핀 정합. 이 테스트가 없으면 FOUC 스크립트를 한 글자 고쳐도 아무 테스트가 깨지지 않고,
 * 프로덕션에서만 CSP 가 그 스크립트를 조용히 차단해 첫 페인트가 깜빡인다(로컬 dev 는 unsafe-eval 때문에 안 드러남).
 */
describe('FOUC 스크립트 CSP 해시', () => {
  it('middleware 의 핀 해시가 실제 스크립트의 sha256 과 일치한다', () => {
    const digest = createHash('sha256').update(THEME_INIT, 'utf8').digest('base64');
    expect(FOUC_SCRIPT_HASH).toBe(`'sha256-${digest}'`);
  });
});

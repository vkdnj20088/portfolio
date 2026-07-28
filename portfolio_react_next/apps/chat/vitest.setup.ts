import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// 각 테스트가 마운트한 트리를 정리한다(globals 를 끄고 명시 등록 - chat-domain 과 같은 스타일).
afterEach(() => {
  cleanup();
});

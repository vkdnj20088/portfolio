import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// 각 테스트가 마운트한 트리(및 포털)를 정리한다.
afterEach(() => {
  cleanup();
});

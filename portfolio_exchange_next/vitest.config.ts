import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

// 엔진/유틸 순수 로직 단위 테스트 - node 환경(브라우저/DOM 불필요).
export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "store/**/*.test.ts", "components/**/*.test.tsx"],
  },
  resolve: {
    alias: { "@": resolve(__dirname, ".") },
  },
});

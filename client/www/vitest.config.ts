import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // SidekickDB: render components in tests (__tests__/self-hosted-network.test.tsx).
  esbuild: { jsx: 'automatic' },
  resolve: { alias: { '@': path.resolve(__dirname) } },
  test: {
    include: ['**/*.test.ts', '**/*.test.tsx'],
  },
});

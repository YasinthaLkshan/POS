import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/out/**', '**/.cache/**'],
    testTimeout: 30000,
    hookTimeout: 60000,
    fileParallelism: false,
  },
});

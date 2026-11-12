import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 180000,
  workers: 1,
  fullyParallel: false,
  use: { trace: 'retain-on-failure' },
  webServer: {
    command: 'node --import tsx scripts/test-server.ts',
    url: 'http://127.0.0.1:4199/health',
    reuseExistingServer: false,
    timeout: 60000,
  },
});

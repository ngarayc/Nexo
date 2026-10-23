import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/system',
  testMatch: '**/*.spec.mjs',
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  timeout: 30000,
  reporter: [
    ['json', { outputFile: process.env.NEXO_SYSTEM_REPORT ?? 'reports/playwright-raw.json' }],
  ],
  use: {
    baseURL: 'http://localhost:8081',
    trace: 'off',
    screenshot: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});

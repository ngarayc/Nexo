import { defineConfig, devices } from '@playwright/test';
import ordinary from './playwright.config.mjs';

export default defineConfig({
  ...ordinary,
  projects: [
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});

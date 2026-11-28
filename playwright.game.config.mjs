import { defineConfig } from '@playwright/test';
import config from './playwright.config.mjs';
export default defineConfig({
  ...config,
  testMatch: 'nekopara3.spec.mjs',
  outputDir: '.local/playwright-game',
  timeout: 180000,
  webServer: undefined,
  use: {
    ...config.use,
    actionTimeout: 30000,
    viewport: { width: 1365, height: 1000 },
    baseURL: process.env.CAT2_GAME_URL || 'http://localhost:4101',
  },
});

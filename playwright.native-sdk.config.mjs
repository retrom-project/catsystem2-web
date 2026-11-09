import { defineConfig } from '@playwright/test';
import config from './playwright.game.config.mjs';

export default defineConfig({
  ...config,
  testMatch: 'native-sdk.spec.mjs',
  outputDir: '.local/playwright-native-sdk',
  timeout: 30 * 60_000,
  use: { ...config.use, baseURL: process.env.CAT2_SDK_URL || 'http://localhost:4111' },
});

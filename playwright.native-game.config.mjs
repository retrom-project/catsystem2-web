import { defineConfig } from '@playwright/test';
import config from './playwright.game.config.mjs';

export default defineConfig({
  ...config,
  testMatch: 'native-nekopara3.spec.mjs',
  outputDir: '.local/playwright-native-game',
  timeout: 20 * 60_000,
});

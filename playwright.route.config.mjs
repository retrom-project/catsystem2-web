import { defineConfig } from '@playwright/test';
import config from './playwright.game.config.mjs';
export default defineConfig({
  ...config,
  testMatch: 'nekopara3-route.spec.mjs',
  outputDir: '.local/playwright-route',
});

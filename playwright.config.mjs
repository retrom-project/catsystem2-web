import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  testMatch: 'public.spec.mjs',
  fullyParallel: false,
  workers: 1,
  outputDir: '.local/playwright',
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4110',
    headless: true,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
      ],
    },
  },
  webServer: {
    command: 'node scripts/serve.mjs --port 4110',
    url: 'http://127.0.0.1:4110',
    reuseExistingServer: false,
  },
});

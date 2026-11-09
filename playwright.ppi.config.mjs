// SPDX-License-Identifier: MPL-2.0
import base from './playwright.config.mjs';
export default {
  ...base,
  testMatch: ['ppi.spec.mjs', 'ppi-world.spec.mjs'],
  outputDir: '.local/playwright-ppi',
  use: { ...base.use, baseURL: 'http://127.0.0.1:4113' },
  webServer: {
    command: 'node scripts/serve.mjs --port 4113',
    url: 'http://127.0.0.1:4113',
    reuseExistingServer: false,
  },
};

// SPDX-License-Identifier: MPL-2.0
import base from './playwright.config.mjs';
export default {
  ...base,
  testMatch: ['native-screen-capture.spec.mjs', 'native-image-commands.spec.mjs'],
  outputDir: '.local/playwright-capture',
  use: { ...base.use, baseURL: 'http://127.0.0.1:4117' },
  webServer: {
    command: 'node scripts/serve.mjs --port 4117',
    url: 'http://127.0.0.1:4117',
    reuseExistingServer: false,
  },
};

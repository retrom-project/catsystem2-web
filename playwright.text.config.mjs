// SPDX-License-Identifier: MPL-2.0
import base from './playwright.config.mjs';
export default {
  ...base,
  testMatch: [
    'native-text.spec.mjs',
    'native-screen-effect.spec.mjs',
    'native-retained-owner.spec.mjs',
    'native-render-budget.spec.mjs',
    'native-graphics-receiver.spec.mjs',
    'native-controls.spec.mjs',
  ],
  outputDir: '.local/playwright-text',
  use: { ...base.use, baseURL: 'http://127.0.0.1:4115' },
  webServer: {
    command: 'node scripts/serve.mjs --port 4115',
    url: 'http://127.0.0.1:4115',
    reuseExistingServer: false,
  },
};

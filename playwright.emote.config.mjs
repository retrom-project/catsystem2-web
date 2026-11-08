// SPDX-License-Identifier: MPL-2.0
import base from './playwright.config.mjs';
export default {
  ...base,
  testMatch: 'emote-native.spec.mjs',
  outputDir: '.local/playwright-emote',
  use: {
    ...base.use,
    baseURL: 'http://127.0.0.1:4114',
    launchOptions: {
      ...base.use.launchOptions,
      args: [...base.use.launchOptions.args, '--autoplay-policy=no-user-gesture-required'],
    },
  },
  webServer: {
    command: 'node scripts/serve.mjs --port 4114',
    url: 'http://127.0.0.1:4114',
    reuseExistingServer: false,
  },
};

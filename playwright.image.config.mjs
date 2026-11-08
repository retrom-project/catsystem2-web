import base from './playwright.config.mjs';
export default {
  ...base,
  testMatch: ['native-image-owners.spec.mjs', 'native-bitmap-upload.spec.mjs'],
  outputDir: '.local/playwright-image',
};

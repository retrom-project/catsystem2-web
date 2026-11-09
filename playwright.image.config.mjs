import base from './playwright.config.mjs';
export default {
  ...base,
  testMatch: [
    'native-image-owners.spec.mjs',
    'native-bitmap-upload.spec.mjs',
    'native-image-composite.spec.mjs',
    'native-render-sources.spec.mjs',
    'native-tile-plane.spec.mjs',
    'native-plane-trail.spec.mjs',
    'native-view-geometry.spec.mjs',
    'native-area-effect.spec.mjs',
  ],
  outputDir: '.local/playwright-image',
};

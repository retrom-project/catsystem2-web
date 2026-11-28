// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { validateMediaSource, checkMediaBoundary } from '../scripts/check-media-boundary.mjs';
test('media modules reject direct and address-free EXE execution, including projection work in text construction', () => {
  for (const source of [
    "import x from '../oracle/text.mjs';",
    "import x from './engine-process.mjs';",
    'runtime.call(target, args);',
    "world['invokeNative']('image.decode');",
    "world.registerNativeFeature('text',async()=>world.getNativeFeature('data-buffers'));",
    "world.getNativeFeature('text');",
    'const handler=0x6970a0;',
  ])
    assert.throws(() => validateMediaSource(source, 'src/native/text.mjs'), /EXE/);
  validateMediaSource('writer.parse(); world.text.runtime();', 'src/native/text-task.mjs');
});
test('completed media files, dispatch records and consumer boundaries agree', () =>
  checkMediaBoundary(fileURLToPath(new URL('..', import.meta.url))));

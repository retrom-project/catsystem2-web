// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  validateMediaInventory,
  validateMediaSource,
  checkMediaBoundary,
} from '../scripts/check-media-boundary.mjs';
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
test('media inventory cannot hide EXE implementations, unresolved names or unowned projections', () => {
  const names = [
    'js-bitmap-to-exe-consumers',
    'js-image-owner-to-exe-consumers',
    'js-log-to-exe-fes-consumer',
    'js-text-to-exe-fes-consumers',
    'js-image-data-to-exe-consumers',
  ];
  const board = {
    profiles: [{ entries: [{ domain: 5, implementation: 'pure-js', review: 'traced' }] }],
    files: [],
    remainingProfileSelections: { profileIndexSites: [], addressSelections: [], versionGuards: [] },
    nonNativeEntries: names.map((name) => ({
      name,
      domain: 7,
      projection: { authority: 'JS', consumers: [{ domain: 7 }], removePhase: 7 },
    })),
  };
  validateMediaInventory(board);
  for (const mutate of [
    (b) => (b.profiles[0].entries[0].implementation = 'unknown'),
    (b) => (b.profiles[0].entries[0].review = 'needs-review'),
    (b) =>
      b.files.push({
        file: 'src/native/text.mjs',
        domain: 5,
        exeDependencies: { addresses: 1, calls: 0, references: 0 },
        executionSites: [],
      }),
    (b) => (b.nonNativeEntries[0].projection.removePhase = 5),
    (b) => b.remainingProfileSelections.addressSelections.push({ domain: 5 }),
  ]) {
    const b = structuredClone(board);
    mutate(b);
    assert.throws(() => validateMediaInventory(b), /Media/);
  }
});
test('completed media files, dispatch records and consumer boundaries agree', () =>
  checkMediaBoundary(fileURLToPath(new URL('..', import.meta.url))));

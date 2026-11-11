// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  validateRenderInventory,
  validateRenderSource,
  checkRenderBoundary,
} from '../scripts/check-render-boundary.mjs';

test('render modules reject direct/indirect execution and unreviewed consumer construction', () => {
  for (const source of [
    "import old from '../../oracle/graphics-render-original.mjs';",
    "import old from './transitional-exe.mjs';",
    'const target = 0x5df010;',
    'engine.call(target);',
    "engine['callFromHost'](target);",
    'const { call } = engine;',
    'engine.invokeRegion(name);',
    'world.ensureNativeEngine();',
    "world.getNativeFeature('new-unreviewed-exe-code');",
  ])
    assert.throws(() => validateRenderSource(source, 'src/native/graphics.mjs'), /Render/);
  validateRenderSource(
    "world.getNativeFeature('plane-movie-projection');",
    'src/native/graphics.mjs',
  );
  const ppi = "import {loadUnicorn} from './ppi/backend.mjs';";
  assert.throws(() => validateRenderSource(ppi, 'src/particles.mjs'), /Render/);
  assert.throws(() => validateRenderSource(ppi, 'src/native/graphics.mjs'), /Render/);
});

test('render inventory cannot hide handlers, selectors, foreign consumers or removed graphics workers', async () => {
  const board = JSON.parse(
    await readFile(new URL('../docs/b-migration.json', import.meta.url), 'utf8'),
  );
  validateRenderInventory(board);
  for (const mutate of [
    (b) => (b.profiles[0].entries.find((e) => e.domain === 6).implementation = 'exe-region'),
    (b) => (b.profiles[0].entries.find((e) => e.domain === 6).review = 'needs-review'),
    (b) => (b.profiles[0].entries.find((e) => e.domain === 6).semanticName = null),
    (b) => b.files.find((f) => f.domain === 6).exeDependencies.addresses++,
    (b) =>
      b.files
        .find((f) => f.domain === 6)
        .indirectSites.push({ method: 'getNativeFeature', feature: 'unreviewed' }),
    (b) => b.remainingProfileSelections.addressSelections.push({ domain: 6 }),
    (b) => b.nonNativeEntries.push({ name: 'graphics-thread-and-application-tasks', domain: 8 }),
    (b) => b.nonNativeEntries.find((e) => e.projection).projection.consumers.push({ domain: 6 }),
    (b) => (b.nonNativeEntries = b.nonNativeEntries.filter((e) => e.name !== 'js-ppi-host')),
  ]) {
    const changed = structuredClone(board);
    mutate(changed);
    assert.throws(() => validateRenderInventory(changed), /Render/);
  }
});

test('completed rendering modules and registered remaining consumers agree', () =>
  checkRenderBoundary(fileURLToPath(new URL('..', import.meta.url))));

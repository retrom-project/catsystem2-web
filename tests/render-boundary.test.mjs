// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { validateRenderSource, checkRenderBoundary } from '../scripts/check-render-boundary.mjs';

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

test('completed rendering modules and registered remaining consumers agree', () =>
  checkRenderBoundary(fileURLToPath(new URL('..', import.meta.url))));

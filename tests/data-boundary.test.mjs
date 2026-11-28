// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { validateCalculationSource } from '../scripts/check-calculation-boundary.mjs';
import { checkDataBoundary } from '../scripts/check-data-boundary.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
test('data boundary rejects direct loaders and address-free EXE capabilities', () => {
  for (const source of [
    "import x from './transitional-exe.mjs';",
    'world.ensureNativeEngine();',
    'engine.call(target);',
    'engine.callAsync(target);',
    "engine['invokeNative']('data.load');",
  ])
    assert.throws(
      () => validateCalculationSource(source, 'data.mjs', 'Data'),
      /Data.*EXE capability/,
    );
  validateCalculationSource('machine.store(0, 1);', 'data.mjs', 'Data');
});
test('all migrated domain 4 modules satisfy the completed boundary', () => checkDataBoundary(root));

// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateCalculationSource,
  checkCalculationBoundary,
} from '../scripts/check-calculation-boundary.mjs';
import { fileURLToPath } from 'node:url';
test('migrated calculation boundary rejects both direct EXE loaders and address-free capabilities', () => {
  for (const source of [
    "import x from './kcs-memory.mjs';",
    'world.ensureNativeEngine();',
    "host['invokeNative']('math.sin');",
    'engine.call(target, args);',
  ])
    assert.throws(() => validateCalculationSource(source, 'calculation.mjs'), /EXE capability/);
  validateCalculationSource('machine.store(0, 1);', 'calculation.mjs');
});
test('the actual ordinary calculation modules satisfy their source boundary', () =>
  checkCalculationBoundary(fileURLToPath(new URL('..', import.meta.url))));

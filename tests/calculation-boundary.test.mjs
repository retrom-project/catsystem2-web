// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateCalculationSource,
  validateCalculationInventory,
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
test('inventory cannot reclassify an EXE calculation as completed or omit review reasons', () => {
  const board = {
    profiles: [{ entries: [{ domain: 3, implementation: 'pure-js', review: 'traced' }] }],
    files: [],
  };
  validateCalculationInventory(board);
  board.profiles[0].entries[0].implementation = 'original-handler';
  assert.throws(() => validateCalculationInventory(board), /still executes/);
  board.profiles[0].entries[0] = {
    domain: 3,
    implementation: 'pure-js',
    review: 'needs-review',
    reviewReasons: [],
  };
  assert.throws(() => validateCalculationInventory(board), /reason is missing/);
});
test('the actual calculation modules and board satisfy the completed boundary', () =>
  checkCalculationBoundary(fileURLToPath(new URL('..', import.meta.url))));

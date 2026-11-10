// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { validateCalculationSource } from '../scripts/check-calculation-boundary.mjs';
import { validateDataInventory, checkDataBoundary } from '../scripts/check-data-boundary.mjs';
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
test('data inventory cannot hide an EXE native, selector or missing unsupported decision', async () => {
  const source = JSON.parse(
    await readFile(new URL('../docs/b-migration.json', import.meta.url), 'utf8'),
  );
  for (const edit of [
    (board) => {
      board.profiles[0].entries.find((entry) => entry.domain === 4).implementation =
        'original-handler';
    },
    (board) => {
      delete board.profiles
        .flatMap((profile) => profile.entries)
        .find((entry) => entry.domain === 4 && entry.implementation === 'unsupported')
        .migrationReview;
    },
    (board) => {
      board.remainingProfileSelections.profileIndexSites.push({ domain: 4 });
    },
    (board) => {
      board.nonNativeEntries.find(
        (entry) => entry.name === 'js-scene-to-exe-reader-history',
      ).projection.direction = 'PE-to-JS';
    },
  ]) {
    const board = structuredClone(source);
    edit(board);
    assert.throws(() => validateDataInventory(board));
  }
});
test('all migrated domain 4 modules satisfy the completed boundary', () => checkDataBoundary(root));

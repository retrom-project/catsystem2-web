// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  validateFESInventory,
  validateFESSource,
  checkFESBoundary,
} from '../scripts/check-fes-boundary.mjs';

test('FES rejects direct, imported and hidden EXE capabilities', () => {
  for (const source of [
    "import old from '../../oracle/fes-objects-original.mjs';",
    'engine.call(handler);',
    'world.ensureNativeEngine();',
    'const {callFromHost}=engine;',
    'object.nativeObjectPointer=record;',
    "world.getNativeFeature('fes-objects');",
    "world.getNativeFeature('task-memory');",
    "if(!context.nativePointer)world.getNativeFeature('task-memory');",
    "if(context.nativePointer||force)world.getNativeFeature('task-memory');",
  ])
    assert.throws(() => validateFESSource(source, 'src/native/fes-task.mjs'), /FES/);
  validateFESSource(
    "if(key===undefined&&context.nativePointer){world.getNativeFeature('task-memory');}",
    'src/native/fes-task.mjs',
  );
});
test('FES inventory distinguishes reviewed routes, unknown signature metadata and removed projections', async () => {
  const board = JSON.parse(
    await readFile(new URL('../docs/b-migration.json', import.meta.url), 'utf8'),
  );
  validateFESInventory(board);
  for (const mutate of [
    (b) => (b.profiles[0].entries.find((entry) => entry.domain === 7).implementation = 'unknown'),
    (b) => (b.profiles[0].entries.find((entry) => entry.domain === 7).review = 'needs-review'),
    (b) => (b.profiles[0].entries.find((entry) => entry.domain === 7).fesRoute = null),
    (b) => b.files.find((file) => file.domain === 7).exeDependencies.calls++,
    (b) =>
      b.files
        .find((file) => file.domain === 7)
        .indirectSites.push({ method: 'getNativeFeature', feature: 'new-code' }),
    (b) => b.nonNativeEntries.push({ projection: { removePhase: 7, consumers: [] } }),
    (b) => b.remainingProfileSelections.addressSelections.push({ domain: 7 }),
  ]) {
    const changed = structuredClone(board);
    mutate(changed);
    assert.throws(() => validateFESInventory(changed), /FES/);
  }
});
test('FES installed dispatch, defaults and production import boundary agree', () =>
  checkFESBoundary(fileURLToPath(new URL('..', import.meta.url))));

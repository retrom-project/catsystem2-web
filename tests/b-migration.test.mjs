// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { NATIVE_ABIS } from '../src/native/abi/index.mjs';

test('B inventory reproduces the actual overrides, separate tables and complete file counts', async () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  await promisify(execFile)(process.execPath, ['scripts/b-migration.mjs', '--check'], {
    cwd: root,
  });
  const inventory = JSON.parse(
    await readFile(new URL('../docs/b-migration.json', import.meta.url), 'utf8'),
  );
  const baseline = JSON.parse(
    await readFile(new URL('../scripts/exe-dependency-baseline.json', import.meta.url), 'utf8'),
  );
  for (const profile of inventory.profiles) {
    for (const [table, { count }] of Object.entries(NATIVE_ABIS[profile.profile].tables)) {
      const entries = profile.entries.filter((entry) => entry.table === table);
      assert.equal(entries.length, count);
      assert.deepEqual(
        entries.map((entry) => entry.id),
        Array.from({ length: count }, (_, id) => id),
      );
    }
    const entry = (table, id) =>
      profile.entries.find((entry) => entry.table === table && entry.id === id);
    assert.equal(entry('main', 0x32).implementation, 'original-handler');
    assert.equal(entry('generic', 1).implementation, 'pure-js');
    assert.equal(entry('main', 0x24e).module, 'src/native/script-xml.mjs');
    assert.equal(entry('main', 0x24e).implementation, 'original-handler');
    assert.equal(entry('main', 0x1d).implementation, 'pure-js');
    assert.equal(entry('main', 0x237).implementation, 'original-handler');
    assert.equal(entry('main', 0x7a).module, 'src/native/bitmap-operations.mjs');
    assert.equal(entry('main', 0x10f).implementation, 'original-handler');
    assert.equal(entry('particle-v1', 38).review, 'needs-review');
  }
  for (const file of inventory.files) {
    assert.deepEqual(
      file.exeDependencies,
      baseline.files[file.file] ?? { addresses: 0, calls: 0, references: 0 },
    );
    assert.ok(file.domain >= 3 && file.domain <= 9);
  }
  assert.equal(inventory.summary.runtimeFiles, inventory.files.length);
  assert.equal(
    inventory.summary.nativeSlots,
    inventory.profiles.reduce((sum, profile) => sum + profile.entries.length, 0),
  );
  assert.equal(inventory.remainingProfileSelections.totals.needsReview, 0);
  assert.ok(inventory.remainingProfileSelections.profileIndexSites.length > 0);
  assert.ok(inventory.remainingProfileSelections.addressSelections.length > 0);
  assert.ok(
    !inventory.remainingProfileSelections.versionGuards.some(
      (row) => row.file.includes('scalar-math') || row.file.includes('config-fields'),
    ),
  );
  assert.ok(inventory.nonNativeEntries.some((entry) => entry.name === 'winmain-regions'));
  assert.ok(
    inventory.nonNativeEntries.some(
      (entry) => entry.name === 'patch-points' && entry.executionSites.length,
    ),
  );
});

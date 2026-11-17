// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { NATIVE_ABIS } from '../src/native/abi/index.mjs';
import { scanRuntime } from '../scripts/check-no-exe-addresses.mjs';

test('B inventory reproduces the actual overrides, separate tables and complete file counts', async () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  await promisify(execFile)(process.execPath, ['scripts/b-migration.mjs', '--check'], {
    cwd: root,
  });
  const inventory = JSON.parse(
    await readFile(new URL('../docs/b-migration.json', import.meta.url), 'utf8'),
  );
  const runtime = await scanRuntime(root);
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
    assert.equal(entry('main', 0x32).implementation, 'pure-js');
    assert.equal(entry('generic', 1).implementation, 'pure-js');
    assert.equal(entry('main', 0x24e).module, 'src/native/xml.mjs');
    assert.equal(entry('main', 0x24e).implementation, 'pure-js');
    assert.equal(entry('main', 0x1d).implementation, 'pure-js');
    assert.equal(entry('main', 0x237).implementation, 'pure-js');
    assert.equal(entry('main', 0x7a).module, 'src/native/bitmap-operations.mjs');
    assert.equal(entry('main', 0x10f).implementation, 'pure-js');
    assert.equal(entry('particle-v1', 38).implementation, 'pure-js');
  }
  for (const file of inventory.files) {
    assert.deepEqual(
      file.exeDependencies,
      runtime[file.file] ?? { addresses: 0, calls: 0, references: 0 },
    );
    assert.ok(file.domain >= 3 && file.domain <= 9);
  }
  assert.equal(inventory.summary.runtimeFiles, inventory.files.length);
  assert.equal(
    inventory.summary.nativeSlots,
    inventory.profiles.reduce((sum, profile) => sum + profile.entries.length, 0),
  );
  assert.equal(inventory.remainingProfileSelections.totals.needsReview, 0);
  assert.equal(
    inventory.remainingProfileSelections.profileIndexSites.length,
    0,
    'all profileIndex variables have migrated; semantic VA selectors remain separately counted',
  );
  assert.equal(inventory.remainingProfileSelections.addressSelections.length, 0);
  assert.ok(
    !inventory.remainingProfileSelections.versionGuards.some(
      (row) => row.file.includes('scalar-math') || row.file.includes('config-fields'),
    ),
  );
  assert.equal(
    inventory.nonNativeEntries.some((entry) => entry.name === 'winmain-regions'),
    false,
  );
  assert.equal(
    inventory.nonNativeEntries.some((entry) => entry.name === 'patch-points'),
    false,
  );
});

test('ordinary catalog exposes semantic ABI entries while physical table locations stay oracle-only', async () => {
  const ordinary = await import('../src/native/catalog.mjs');
  assert.equal(Object.hasOwn(ordinary, 'NATIVE_EXE_PROFILES'), false);
  const { NATIVE_EXE_PROFILES } = await import('../oracle/executable-catalog.mjs');
  assert.equal(Object.keys(NATIVE_EXE_PROFILES).length, 2);
  for (const [profile, physical] of Object.entries(NATIVE_EXE_PROFILES)) {
    assert.equal(physical.sha256.length, 64);
    for (const [table, location] of Object.entries(physical.tables)) {
      const semantic = ordinary.nativeCatalog(profile, table);
      assert.equal(semantic.length, location.count);
      assert.equal(Number.isSafeInteger(location.va), true);
      for (const entry of semantic) {
        assert.equal(Object.hasOwn(entry, 'va'), false);
        assert.equal(Object.hasOwn(entry, 'sha256'), false);
        assert.equal(entry.profile, profile);
        assert.equal(entry.table, table);
      }
    }
  }
});

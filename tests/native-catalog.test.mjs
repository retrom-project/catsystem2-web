// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';

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

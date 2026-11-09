// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NATIVE_ABIS,
  nativeABI,
  abiForEngineVersion,
  validateABI,
} from '../src/native/abi/index.mjs';
import { nativeCatalog } from '../src/native/catalog.mjs';

test('per-version ABI data covers every slot and preserves unresolved facts', () => {
  assert.deepEqual(
    Object.values(NATIVE_ABIS).map((abi) => abi.engineVersion),
    ['2.6.1.74', '2.6.1.76'],
  );
  let slots = 0;
  for (const abi of Object.values(NATIVE_ABIS)) {
    assert.equal(abiForEngineVersion(abi.engineVersion), nativeABI(abi.profile));
    assert.ok(Object.isFrozen(abi.tables.main.entries));
    for (const [table, definition] of Object.entries(abi.tables)) {
      slots += definition.count;
      assert.equal(nativeCatalog(abi.profile, table).length, definition.count);
      assert.ok(definition.entries.every((entry, id) => entry.id === id));
    }
  }
  assert.equal(slots, 2344);
  const unknown = nativeABI('sdk-4.01-engine-2.6.1.74').tables.main.entries[0x52];
  assert.equal(unknown.name, null);
  assert.equal(unknown.signature.parameters, null);
  assert.equal(unknown.signature.review, 'needs-review');
  assert.throws(() => nativeABI('unregistered'), /provide reviewed per-version ABI data/);
  assert.throws(() => abiForEngineVersion('2.6.1.99'), /2.6.1.99.*ABI data/);
});

test('ABI validation rejects missing slots and invalid controls', () => {
  const abi = structuredClone(Object.values(NATIVE_ABIS)[0]);
  abi.tables.main.entries.pop();
  assert.throws(() => validateABI(abi), /Incomplete ABI table/);
  const invalid = structuredClone(Object.values(NATIVE_ABIS)[0]);
  invalid.tables.generic.entries[1].controlCodes = [6];
  assert.throws(() => validateABI(invalid), /Invalid ABI entry/);
});

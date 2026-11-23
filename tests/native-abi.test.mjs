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
    ['2.6.1.74', '2.6.1.76', '2.6.1.63', '2.6.1.67', '2.6.1.23'],
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
  assert.equal(slots, 5509);
  assert.equal(
    ['2.6.1.74', '2.6.1.76']
      .flatMap((version) => Object.values(abiForEngineVersion(version).tables))
      .reduce((total, table) => total + table.count, 0),
    2344,
  );
  for (const [version, fileStatus] of [
    ['2.6.1.63', 'recovered'],
    ['2.6.1.67', 'unknown'],
  ]) {
    const abi = abiForEngineVersion(version);
    assert.equal(abi.tables.main.count, 938);
    assert.equal(abi.tables.main.entries[0x181].signature.argumentWords, 4);
    assert.equal(abi.tables.main.entries[0x181].status, fileStatus);
    assert.equal(abi.tables.main.entries[0x358].signature.argumentWords, 7);
    assert.equal(abi.tables.main.entries[0x358].status, 'unknown');
  }
  const base = abiForEngineVersion('2.6.1.23').tables;
  assert.deepEqual(
    Object.values(base).map(({ count }) => count),
    [869, 45, 44, 51],
  );
  assert.equal(base.main.entries.filter(({ status }) => status === 'recovered').length, 69);
  assert.equal(base.main.entries.filter(({ status }) => status === 'unknown').length, 800);
  assert.equal(base.main.entries[108].signature.resultWritten, false);
  assert.deepEqual(
    base.generic.entries.filter(({ status }) => status === 'recovered').map(({ id }) => id),
    [17, 38, 41],
  );
  assert.equal(base.generic.entries[17].signature.resultWritten, true);
  assert.equal(base.generic.entries[38].signature.resultWritten, false);
  assert.equal(base.generic.entries[41].signature.resultWritten, true);
  for (const table of [base['particle-v1'], base['particle-v2']])
    assert.ok(table.entries.every(({ status }) => status === 'unknown'));
  for (const id of [287, 288, 629]) assert.equal(base.main.entries[id].status, 'unknown');
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

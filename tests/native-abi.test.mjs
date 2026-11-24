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
  for (const version of ['2.6.1.63', '2.6.1.67']) {
    const abi = abiForEngineVersion(version);
    assert.equal(abi.tables.main.count, 938);
    assert.equal(abi.tables.main.entries[0x181].signature.argumentWords, 4);
    assert.equal(abi.tables.main.entries[0x181].status, 'recovered');
    assert.equal(abi.tables.main.entries[0x358].signature.argumentWords, 7);
    assert.equal(abi.tables.main.entries[0x358].status, 'unknown');
  }
  const base = abiForEngineVersion('2.6.1.23').tables;
  assert.deepEqual(
    Object.values(base).map(({ count }) => count),
    [869, 45, 44, 51],
  );
  assert.equal(base.main.entries.filter(({ status }) => status === 'recovered').length, 385);
  assert.equal(base.main.entries.filter(({ status }) => status === 'reserved').length, 57);
  assert.equal(base.main.entries.filter(({ status }) => status === 'constant-zero').length, 17);
  assert.equal(base.main.entries.filter(({ status }) => status === 'unknown').length, 410);
  assert.equal(base.main.entries.filter((entry) => entry.observedArgumentWords.length).length, 435);
  assert.deepEqual(base.main.entries[464].observedArgumentWords, []);
  assert.deepEqual(base.main.entries[543].observedArgumentWords, [3]);
  assert.deepEqual(base.main.entries[575].observedArgumentWords, [3]);
  assert.equal(base.main.entries[108].signature.resultWritten, false);
  assert.equal(base.main.entries[315].signature.argumentWords, 2);
  assert.deepEqual(base.main.entries[315].observedArgumentWords, [1]);
  assert.deepEqual(
    base.generic.entries.filter(({ status }) => status === 'recovered').map(({ id }) => id),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16, 17, 23, 26, 38, 39, 40, 41, 42],
  );
  assert.equal(base.generic.entries[17].signature.resultWritten, true);
  for (const [id, count] of [
    [23, 4],
    [26, 1],
  ]) {
    assert.equal(base.generic.entries[id].signature.argumentWords, count);
    assert.equal(base.generic.entries[id].signature.resultWritten, false);
    assert.deepEqual(base.generic.entries[id].signature.controlCodes, [2]);
  }
  assert.equal(base.generic.entries[38].signature.resultWritten, false);
  assert.equal(base.generic.entries[41].signature.resultWritten, true);
  const particle = [
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 19, 20, 21, 22, 23, 24, 25, 26, 27,
    28, 30, 31, 32, 33, 34, 35, 36, 39, 40, 41, 42, 43,
  ];
  for (const [table, ids] of [
    ['particle-v1', particle],
    ['particle-v2', [...particle, 50]],
  ]) {
    assert.deepEqual(
      base[table].entries.filter(({ status }) => status === 'recovered').map(({ id }) => id),
      ids,
    );
    assert.equal(base[table].entries[3].signature.resultWritten, true);
    assert.equal(base[table].entries[32].signature.resultWritten, false);
    assert.deepEqual(base[table].entries[32].signature.controlCodes, [4]);
    for (const id of [22, 23, 24, 25, 26]) {
      const { signature } = base[table].entries[id];
      assert.equal(signature.argumentWords, id <= 24 ? 2 : 4);
      assert.equal(signature.resultWritten, false);
      assert.deepEqual(signature.controlCodes, [2]);
    }
  }
  for (const entry of [
    base.generic.entries[42],
    base['particle-v1'].entries[43],
    base['particle-v2'].entries[43],
  ]) {
    assert.equal(entry.signature.argumentWords, 2);
    assert.equal(entry.signature.resultWritten, true);
    assert.deepEqual(entry.signature.controlCodes, [1]);
  }
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

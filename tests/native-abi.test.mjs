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
    assert.equal(abi.tables.main.entries[0x358].status, 'recovered');
  }
  const base = abiForEngineVersion('2.6.1.23').tables;
  assert.deepEqual(
    Object.values(base).map(({ count }) => count),
    [869, 45, 44, 51],
  );
  assert.equal(base.main.entries.filter(({ status }) => status === 'recovered').length, 752);
  assert.equal(base.main.entries.filter(({ status }) => status === 'reserved').length, 57);
  assert.equal(base.main.entries.filter(({ status }) => status === 'constant-zero').length, 17);
  assert.equal(base.main.entries.filter(({ status }) => status === 'unknown').length, 43);
  assert.equal(base.main.entries.filter((entry) => entry.observedArgumentWords.length).length, 447);
  assert.deepEqual(base.main.entries[464].observedArgumentWords, []);
  assert.deepEqual(base.main.entries[543].observedArgumentWords, [3]);
  assert.deepEqual(base.main.entries[575].observedArgumentWords, [3]);
  assert.equal(base.main.entries[108].signature.resultWritten, false);
  assert.deepEqual(
    [289, 290, 291, 292, 293].map((id) => {
      const { status, signature } = base.main.entries[id];
      assert.equal(status, 'recovered');
      return [signature.argumentWords, signature.controlCodes, signature.resultWritten];
    }),
    [
      [3, [1], true],
      [1, [2], false],
      [4, [2], false],
      [4, [1, 2], null],
      [4, [1, 2], null],
    ],
  );
  assert.equal(base.main.entries[289].signature.result.handleKind, 'name-pairs');
  assert.equal(base.main.entries[292].signature.parameters[1].type.target.encoding, 'CP932');
  assert.equal(base.main.entries[837].status, 'unknown');
  for (const [id, words, direction, control] of [
    [26, 1, 'in', 1],
    [37, 3, 'out', 2],
  ]) {
    const { status, signature } = base.main.entries[id];
    assert.equal(status, 'recovered');
    assert.equal(signature.argumentWords, words);
    assert.equal(signature.parameters[0].type.direction, direction);
    assert.deepEqual(signature.controlCodes, [control]);
    assert.equal(signature.resultWritten, control === 1);
  }
  for (const id of [27, 28]) {
    const { status, signature } = base.main.entries[id];
    assert.equal(status, 'recovered');
    assert.equal(signature.argumentWords, 1);
    assert.deepEqual(signature.controlCodes, [1]);
    assert.equal(signature.resultWritten, true);
  }
  assert.equal(base.main.entries[82].name, 'plane.loadColoredKX2');
  assert.equal(base.main.entries[82].signature.argumentWords, 2);
  assert.deepEqual(base.main.entries[82].controlCodes, [2]);
  assert.equal(base.main.entries[82].signature.resultWritten, false);
  for (const [id, words] of [
    [123, 3],
    [126, 3],
    [127, 2],
    [128, 2],
    [129, 1],
    [131, 2],
    [132, 1],
    [138, 3],
    [139, 2],
  ]) {
    const { status, signature } = base.main.entries[id];
    assert.equal(status, 'recovered');
    assert.equal(signature.argumentWords, words);
    assert.equal(signature.parameters[0].type.objectKind, 'legacy-text');
    assert.deepEqual(signature.controlCodes, [id === 129 ? 1 : 2]);
    assert.equal(signature.resultWritten, id === 129);
  }
  const composite = base.main.entries[120];
  assert.equal(composite.name, 'bitmap.composite');
  assert.equal(composite.signature.argumentWords, 4);
  assert.deepEqual(composite.controlCodes, [2]);
  assert.equal(composite.signature.resultWritten, false);
  assert.deepEqual(
    [1, 3].map((index) => composite.signature.parameters[index].type.direction),
    ['in', 'in'],
  );
  for (const [id, owner] of [
    [121, 'bitmap'],
    [713, 'image-owner'],
  ]) {
    const { status, signature } = base.main.entries[id];
    assert.equal(status, 'recovered');
    assert.equal(signature.argumentWords, 4);
    assert.deepEqual(signature.controlCodes, [2]);
    assert.equal(signature.resultWritten, false);
    assert.equal(signature.parameters[0].type.handleKind, owner);
    assert.deepEqual(
      signature.parameters.slice(1).map(({ name }) => name),
      ['red', 'green', 'blue'],
    );
  }
  for (const id of [74, 75, 77, 107]) {
    const { status, signature } = base.main.entries[id];
    assert.equal(status, 'recovered');
    assert.equal(signature.argumentWords, 1);
    assert.deepEqual(signature.controlCodes, [1]);
    assert.equal(signature.resultWritten, true);
  }
  for (const [id, width, control] of [
    [96, 3, 2],
    [97, 2, 2],
    [98, 1, 1],
  ]) {
    const { status, signature } = base.main.entries[id];
    assert.equal(status, 'recovered');
    assert.equal(signature.argumentWords, width);
    assert.deepEqual(signature.controlCodes, [control]);
    assert.equal(signature.resultWritten, control === 1);
  }
  assert.equal(base.main.entries[315].signature.argumentWords, 2);
  assert.deepEqual(base.main.entries[315].observedArgumentWords, [1]);
  for (const id of [122, 705]) {
    const { status, signature } = base.main.entries[id];
    assert.equal(status, 'recovered');
    assert.equal(signature.argumentWords, 3);
    assert.equal(signature.resultWritten, false);
    assert.deepEqual(signature.controlCodes, [2]);
    assert.equal(signature.parameters[0].type.handleKind, 'bitmap');
  }
  for (const [index, width] of [1, 1, 1, 2, 3, 3, 6, 1, 1, 1, 3, 4].entries()) {
    const id = 405 + index,
      { status, signature } = base.main.entries[id],
      close = id === 406 || id === 413;
    assert.equal(status, 'recovered');
    assert.equal(signature.argumentWords, width);
    assert.equal(signature.resultWritten, !close);
    assert.deepEqual(signature.controlCodes, [close ? 2 : 1]);
  }
  assert.deepEqual(
    base.generic.entries.filter(({ status }) => status === 'recovered').map(({ id }) => id),
    [
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
      26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44,
    ],
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
  for (const [main, particle, width] of [
    [7, 4, 0],
    [53, 9, 1],
    [55, 11, 1],
    [56, 13, 1],
    [58, 15, 1],
    [59, 16, 2],
    [60, 17, 1],
    [61, 18, 2],
    [321, 43, 2],
  ]) {
    for (const [table, id] of [
      ['main', main],
      ['particle-v1', particle],
      ['particle-v2', particle],
    ]) {
      const { status, signature } = base[table].entries[id];
      assert.equal(status, 'recovered');
      assert.equal(signature.argumentWords, width);
      assert.equal(signature.resultWritten, true);
      assert.deepEqual(signature.controlCodes, [1]);
    }
  }
  const particle = [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
    26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43,
  ];
  for (const [table, ids] of [
    ['particle-v1', particle],
    ['particle-v2', [...particle, 44, 45, 46, 47, 48, 49, 50]],
  ]) {
    assert.deepEqual(
      base[table].entries.filter(({ status }) => status === 'recovered').map(({ id }) => id),
      ids,
    );
    assert.equal(base[table].entries[3].signature.resultWritten, true);
    const texture = base[table].entries[29].signature;
    assert.equal(texture.argumentWords, 4);
    assert.deepEqual(
      texture.parameters.map(({ type }) => type.kind),
      ['float', 'ignored', 'float', 'ignored'],
    );
    assert.deepEqual(texture.controlCodes, [2]);
    assert.equal(texture.resultWritten, false);
    assert.equal(base[table].entries[37].signature.argumentWords, 6);
    assert.equal(base[table].entries[37].signature.resultWritten, true);
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
  const extensions = base['particle-v2'].entries;
  for (const id of [44, 45]) {
    const { signature } = extensions[id];
    assert.equal(signature.argumentWords, 1);
    assert.equal(signature.parameters[0].type.kind, 'ignored');
    assert.deepEqual(signature.controlCodes, [2]);
    assert.equal(signature.resultWritten, false);
  }
  for (const id of [46, 47]) {
    assert.equal(extensions[id].signature.argumentWords, 0);
    assert.equal(extensions[id].signature.resultWritten, true);
    assert.deepEqual(extensions[id].signature.controlCodes, [1]);
  }
  for (const [id, words] of [
    [48, 2],
    [49, 3],
  ]) {
    const { signature } = extensions[id];
    assert.equal(signature.argumentWords, words);
    assert.equal(signature.resultWritten, false);
    assert.deepEqual(signature.controlCodes, [2]);
    assert(signature.parameters.every(({ type }) => type.direction === 'out'));
  }
  for (const [id, argumentWords, control] of [
    [89, 1, 1],
    [90, 4, 2],
    [91, 1, 2],
    [102, 2, 2],
    [103, 2, 2],
  ]) {
    const { status, signature } = base.main.entries[id];
    assert.equal(status, 'recovered');
    assert.equal(signature.argumentWords, argumentWords);
    assert.equal(signature.resultWritten, control === 1);
    assert.deepEqual(signature.controlCodes, [control]);
  }
  for (const id of [287, 288, 688]) assert.equal(base.main.entries[id].status, 'unknown');
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

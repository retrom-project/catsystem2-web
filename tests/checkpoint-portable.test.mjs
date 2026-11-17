// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
import { checkpointDifference } from './browser/checkpoint-observation.mjs';

test('portable checkpoint budgets apply to encode, compressed files and decoded state', async () => {
  const state = { bytes: new Uint8Array(400) };
  await assert.rejects(serializeCheckpoint(state, 128), /Checkpoint exceeds/);
  const file = await serializeCheckpoint(state, 1024);
  assert.ok(file.length <= 1024);
  assert.equal((await deserializeCheckpoint(file, 1024)).bytes.length, 400);
  await assert.rejects(deserializeCheckpoint(file, 128), /checkpoint|Checkpoint/);
});

test('portable checkpoints retain binary aliases, cyclic containers and 64-bit audio positions', async () => {
  const buffer = new ArrayBuffer(24),
    bytes = new Uint8Array(buffer),
    words = new Uint32Array(buffer, 4, 3),
    state = {
      format: 'catsystem2-web',
      buffer,
      bytes,
      words,
      view: new DataView(buffer, 1, 7),
      loopEnd: -1n,
      large: 0x123456789abcdef0n,
      values: [undefined, NaN, Infinity, -Infinity, -0],
      map: new Map(),
      set: new Set(),
      date: new Date('2026-11-08T00:00:00Z'),
    };
  bytes.set(Array.from({ length: 24 }, (_, i) => i));
  state.self = state;
  state.map.set(state, words);
  state.set.add(state.map);
  const file = await serializeCheckpoint(state),
    restored = await deserializeCheckpoint(file);
  assert.notEqual(restored, state);
  assert.equal(restored.self, restored);
  assert.equal(restored.bytes.buffer, restored.buffer);
  assert.equal(restored.words.buffer, restored.buffer);
  assert.equal(restored.view.buffer, restored.buffer);
  assert.equal(restored.view.byteOffset, 1);
  assert.equal(restored.map.get(restored), restored.words);
  assert.ok(restored.set.has(restored.map));
  assert.deepEqual(restored.bytes, bytes);
  assert.deepEqual(restored.values, state.values);
  assert.equal(restored.loopEnd, -1n);
  assert.equal(restored.large, state.large);
  assert.deepEqual(restored.date, state.date);
});

test('portable checkpoints retain sparse arrays, null objects, blobs and own __proto__ properties', async () => {
  const array = new Array(7);
  array[2] = undefined;
  array[6] = 4;
  const record = Object.create(null);
  record.__proto__ = array;
  const state = {
    record,
    blob: new Blob([new Uint8Array([0, 1, 255])], { type: 'application/octet-stream' }),
  };
  const restored = await deserializeCheckpoint(await serializeCheckpoint(state));
  assert.equal(Object.getPrototypeOf(restored.record), null);
  assert.equal(restored.record.__proto__.length, 7);
  assert.equal(0 in restored.record.__proto__, false);
  assert.equal(2 in restored.record.__proto__, true);
  assert.equal(restored.record.__proto__[2], undefined);
  assert.deepEqual(new Uint8Array(await restored.blob.arrayBuffer()), new Uint8Array([0, 1, 255]));
  assert.equal(restored.blob.type, 'application/octet-stream');
});

test('portable checkpoints reject lossy values and malformed compressed files', async () => {
  await assert.rejects(serializeCheckpoint({ callback() {} }), /non-serializable/);
  await assert.rejects(deserializeCheckpoint(new Uint8Array([1, 2, 3])), /Invalid/);
  const file = await serializeCheckpoint({ frame: 17 });
  file[file.length - 1] ^= 255;
  await assert.rejects(deserializeCheckpoint(file));
});

test('complete checkpoint observations compare every byte and retain type and alias differences', async () => {
  const fixture = () => {
    const bytes = new Uint8Array(2 * 1024 * 1024),
      words = new Uint32Array(bytes.buffer, 4, 3),
      sparse = new Array(3),
      state = {
        frame: 573,
        bytes,
        alias: bytes,
        words,
        view: new DataView(bytes.buffer, 1, 7),
        sparse,
        record: Object.assign(Object.create(null), { word: 17 }),
        missing: undefined,
        values: [NaN, Infinity, -Infinity, -0, -1n],
        map: new Map(),
        set: new Set(),
      };
    bytes[bytes.length - 1] = 91;
    sparse[1] = undefined;
    state.self = state;
    state.map.set(state, words);
    state.set.add(state.map);
    return state;
  };
  const saved = await serializeCheckpoint(fixture()),
    equal = await serializeCheckpoint(fixture());
  assert.equal(checkpointDifference(equal, saved), null);
  const lastByte = equal.slice();
  lastByte[lastByte.length - 1] ^= 1;
  assert.deepEqual(checkpointDifference(lastByte, saved), {
    offset: saved.length - 1,
    currentByte: lastByte.at(-1),
    savedByte: saved.at(-1),
  });
  assert.deepEqual(checkpointDifference(equal.subarray(1), saved), {
    currentLength: equal.length - 1,
    savedLength: saved.length,
  });
  for (const mutate of [
    (state) => state.bytes[state.bytes.length - 1]++,
    (state) => {
      state.alias = state.bytes.slice();
    },
    (state) => {
      state.words = new Int32Array(state.bytes.buffer, 4, 3);
    },
    (state) => {
      state.view = new DataView(state.bytes.buffer, 2, 7);
    },
    (state) => {
      state.sparse[0] = undefined;
    },
    (state) => {
      delete state.missing;
    },
    (state) => {
      state.values[3] = 0;
    },
    (state) => {
      state.map.set(state, state.bytes);
    },
    (state) => {
      state.set.clear();
    },
    (state) => {
      state.self = {};
    },
    (state) => {
      state.record = { ...state.record };
    },
    (state) => {
      state.frame = '573';
    },
  ]) {
    const state = fixture();
    mutate(state);
    const different = await serializeCheckpoint(state);
    assert.notEqual(checkpointDifference(different, saved), null);
    assert.notEqual(checkpointDifference(saved, different), null);
  }
  assert.throws(() => checkpointDifference([], saved), /encoded Uint8Array/);
  assert.throws(() => checkpointDifference(saved, []), /encoded Uint8Array/);
});

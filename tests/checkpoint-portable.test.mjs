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

test('checkpoint observations compare original graph values independently of encoding order', async () => {
  const fixture = (reverse = false) => {
    const bytes = new Uint8Array(2 * 1024 * 1024),
      words = new Uint32Array(bytes.buffer, 4, 3),
      sparse = new Array(3),
      record = Object.assign(Object.create(null), { word: 17 }),
      state = {};
    bytes[bytes.length - 1] = 91;
    sparse[1] = undefined;
    const fields = [
      ['frame', 573],
      ['bytes', bytes],
      ['alias', bytes],
      ['words', words],
      ['view', new DataView(bytes.buffer, 1, 7)],
      ['sparse', sparse],
      ['record', record],
      ['missing', undefined],
      ['values', [NaN, Infinity, -Infinity, -0, -1n]],
    ];
    for (const [key, value] of reverse ? fields.toReversed() : fields) state[key] = value;
    state.self = state;
    const entries = [
      [state, words],
      ['bytes', bytes],
      ['number', 17],
    ];
    state.map = new Map(reverse ? entries.toReversed() : entries);
    const members = [state.map, record, undefined, NaN];
    state.set = new Set(reverse ? members.toReversed() : members);
    return state;
  };
  const current = fixture(true),
    saved = fixture();
  assert.equal(await checkpointDifference(current, saved), null);
  const currentFile = await serializeCheckpoint(current),
    savedFile = await serializeCheckpoint(saved);
  assert.notDeepEqual(currentFile, savedFile);
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
    const changed = fixture();
    mutate(changed);
    assert.notEqual(await checkpointDifference(changed, saved), null);
    assert.notEqual(await checkpointDifference(saved, changed), null);
  }
});

test('checkpoint observations match unordered containers with complete later alias constraints', async () => {
  const fixture = (reverse) => {
    const first = { value: 1 },
      second = { value: 1 },
      state = { anchor: reverse ? second : first };
    state.table = new Map([
      [first, second],
      [second, first],
    ]);
    state.members = new Set([first, second]);
    return state;
  };
  assert.equal(await checkpointDifference(fixture(false), fixture(true)), null);
  const bad = fixture(true);
  bad.anchor = { value: 1 };
  assert.equal((await checkpointDifference(fixture(false), bad)).kind, 'alias');
  assert.notEqual(await checkpointDifference(bad, fixture(false)), null);
});

test('checkpoint observations retain full backing bytes, blobs, dates and pure data boundaries', async () => {
  const fixture = () => {
    const buffer = new ArrayBuffer(32);
    return {
      words: new Uint32Array(buffer, 8, 2),
      view: new DataView(buffer, 9, 3),
      date: new Date(1234),
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'application/octet-stream' }),
      bad: null,
    };
  };
  const saved = fixture();
  assert.equal(await checkpointDifference(fixture(), saved), null);
  const padding = fixture();
  new Uint8Array(padding.words.buffer)[31] = 1;
  assert.deepEqual(await checkpointDifference(padding, saved), {
    kind: 'byte',
    path: ['view', 'buffer'],
    offset: 31,
    current: 1,
    saved: 0,
  });
  for (const mutate of [
    (state) => {
      state.date = new Date(4321);
    },
    (state) => {
      state.blob = new Blob([new Uint8Array([1, 2, 4])], { type: 'application/octet-stream' });
    },
    (state) => {
      state.blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'text/plain' });
    },
    (state) => {
      state.bad = () => {};
    },
    (state) => {
      state.bad = Symbol('owned');
    },
    (state) => {
      state.bad = new Map([[Symbol('owned'), 1]]);
    },
    (state) => {
      state.bad = new Set([Symbol('owned')]);
    },
    (state) => {
      state.bad = Promise.resolve(1);
    },
  ]) {
    const changed = fixture();
    mutate(changed);
    assert.notEqual(await checkpointDifference(changed, saved), null);
  }
  let reads = 0;
  const accessor = {
    get value() {
      reads++;
      return 1;
    },
  };
  assert.equal((await checkpointDifference(accessor, { value: 1 })).kind, 'unsupported-accessor');
  assert.equal(reads, 0);
  for (const bad of [
    () => {},
    Symbol('owned'),
    new Map([[Symbol('owned'), 1]]),
    new Set([Symbol('owned')]),
    Promise.resolve(1),
  ])
    assert.notEqual(await checkpointDifference({ bad }, { bad }), null);
});

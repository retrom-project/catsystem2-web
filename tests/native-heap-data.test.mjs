// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeHeapData } from '../src/native/heap-data.mjs';
import { NativeGlobalFile } from '../src/native/persistence.mjs';
import { NativeDataBuffers } from '../src/native/data-buffer.mjs';
import { NativeHandles } from '../src/native/handles.mjs';

function fixture() {
  const handles = new NativeHandles(),
    buffers = new NativeDataBuffers({ handles, read: async () => null }),
    state = { handles, buffers, process: buffers.process },
    output = new Map();
  state.handles.registerType('global-file', {
    snapshot: (file) => file.snapshot(),
    restore: (saved) => {
      const file = new NativeGlobalFile();
      file.restore(saved);
      return file;
    },
  });
  const services = { handles: state.handles, imageDataBuffers: () => state.buffers },
    machine = { store: (at, value) => output.set(at, value) };
  return { ...state, output, call: (id, words) => nativeHeapData(id, words, machine, services) };
}

test('raw heap CTS records copy independent native storage and preserve missing-record output', async () => {
  const f = fixture(),
    file = f.handles.add('global-file', new NativeGlobalFile(19)),
    pointer = (await f.call(0x341, [5])).value;
  assert.ok(pointer > 0x30000000);
  assert.equal(f.process.load(pointer - 4), 1);
  f.process.write(pointer, Uint8Array.of(7, 8, 9, 10, 11));
  assert.deepEqual(await f.call(0x343, [file, 4, 5, pointer]), { control: 1, value: 1 });
  f.process.write(pointer, Uint8Array.of(0, 0, 0, 0, 0));
  const copy = (await f.call(0x344, [file, 4, 24])).value;
  assert.notEqual(copy, pointer);
  assert.equal(f.output.get(24), 5);
  assert.deepEqual(f.process.read(copy, 5), Uint8Array.of(7, 8, 9, 10, 11));
  assert.deepEqual(await f.call(0x344, [file, 0xffffffff, 24]), { control: 1, value: 0 });
  assert.equal(f.output.get(24), 5);
  await f.call(0x342, [pointer]);
  assert.equal(f.process.allocations.has(pointer - 4), false);
  assert.deepEqual(f.process.read(copy, 5), Uint8Array.of(7, 8, 9, 10, 11));
  // These are signed references in the heap header, independent of any handle.
  f.process.store(copy - 4, 2);
  await f.call(0x342, [copy]);
  assert.equal(f.process.load(copy - 4), 1);
  assert.equal(f.process.allocations.has(copy - 4), true);
  f.process.store(copy - 4, 0xffffffff);
  assert.deepEqual(await f.call(0x342, [copy]), { control: 2 });
  assert.equal(f.process.allocations.has(copy - 4), false);
});

test('raw pointers and file handles retain identity in a fresh process image', async () => {
  const before = fixture(),
    file = before.handles.add('global-file', new NativeGlobalFile(71)),
    pointer = (await before.call(0x341, [3])).value;
  before.process.write(pointer, Uint8Array.of(6, 5, 4));
  await before.call(0x343, [file, 9, 3, pointer]);
  const saved = { process: before.process.snapshot(), handles: before.handles.snapshot() },
    after = fixture();
  after.process.restore(saved.process);
  after.handles.restore(saved.handles);
  assert.deepEqual(after.process.read(pointer, 3), Uint8Array.of(6, 5, 4));
  const second = (await after.call(0x344, [file, 9, 0])).value;
  assert.notEqual(second, pointer);
  assert.equal(after.output.get(0), 3);
  assert.deepEqual(after.process.read(second, 3), Uint8Array.of(6, 5, 4));
  await after.call(0x342, [pointer]);
  await after.call(0x342, [second]);
  assert.equal(after.process.allocations.size, 0);
});

test('null raw heap paths do not instantiate a CPU and zero-byte records allocate a header', async () => {
  const missing = {
    imageDataBuffers() {
      throw new Error('unexpected CPU');
    },
  };
  assert.deepEqual(await nativeHeapData(0x342, [0], {}, missing), { control: 2 });
  assert.deepEqual(await nativeHeapData(0x343, [0, 8, 19, 22], {}, missing), {
    control: 1,
    value: 0,
  });
  assert.deepEqual(await nativeHeapData(0x343, [1, 8, 19, 0], {}, missing), {
    control: 1,
    value: 0,
  });
  assert.deepEqual(await nativeHeapData(0x344, [0, 8, 0], {}, missing), { control: 1, value: 0 });
  const f = fixture(),
    file = f.handles.add('global-file', new NativeGlobalFile()),
    zero = (await f.call(0x341, [0])).value;
  assert.equal(f.process.allocations.get(zero - 4), 4);
  await f.call(0x343, [file, 8, 0, zero]);
  const read = (await f.call(0x344, [file, 8, 0])).value;
  assert.equal(f.process.allocations.get(read - 4), 4);
  assert.equal(f.output.get(0), 0);
  await f.call(0x342, [zero]);
  await f.call(0x342, [read]);
  await assert.rejects(f.call(0x341, []), /expects 1/);
});

test('raw CSS copy releases its allocation when the VM size write fails', async () => {
  const f = fixture(),
    file = f.handles.add('global-file', new NativeGlobalFile());
  f.handles.get(file, 'global-file').write(1, Uint8Array.of(1, 2, 3));
  await assert.rejects(
    nativeHeapData(
      0x344,
      [file, 1, 0],
      {
        store() {
          throw new Error('authored VM failure');
        },
      },
      { handles: f.handles, imageDataBuffers: () => f.buffers },
    ),
    /authored VM failure/,
  );
  assert.equal(f.process.allocations.size, 0);
});

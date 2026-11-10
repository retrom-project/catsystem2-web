// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { Binary } from '../src/binary.mjs';
import { KCSMachine } from '../src/kcs/vm.mjs';
import { NativeRuntime } from '../src/native/runtime.mjs';
import { NativeDictionary, nativeDictionary } from '../src/native/dictionary.mjs';
import { nativeHeapData } from '../src/native/heap-data.mjs';

const profile = 'nekopara-vol3-engine-2.6.1.76';
const machine = () =>
  new KCSMachine({
    body: new Binary(Uint8Array.of(59)),
    codeSize: 1,
    data: new Uint8Array(8192),
    stackSize: 1024,
  });
test('dictionary packing preserves caller padding and imports without replacing existing names', () => {
  const dictionary = new NativeDictionary(),
    m = machine();
  dictionary.set(Uint8Array.of(122), 9);
  dictionary.set(Uint8Array.of(65, 65, 65), 0xffffffff);
  const output = new Uint8Array(dictionary.size).fill(0xa5);
  dictionary.write(output);
  assert.deepEqual(
    [...output],
    [2, 0, 0, 0, 65, 65, 65, 0, 255, 255, 255, 255, 122, 0, 165, 165, 9, 0, 0, 0],
  );
  m.bytes(128, output.length).set(output);
  const restored = new NativeDictionary();
  restored.set(Uint8Array.of(122), 71);
  restored.importFrom(m, 128);
  assert.equal(restored.get(Uint8Array.of(122)), 71);
  assert.equal(restored.get(Uint8Array.of(65, 65, 65)), 0xffffffff);
});
test('dictionary handles survive a fresh runtime checkpoint and retain native byte ordering', async () => {
  const runtime = new NativeRuntime({ profile, read: async () => null }),
    m = machine(),
    services = { handles: runtime.handles, format: (at) => m.string(at) },
    invoke = (id, args = []) => nativeDictionary(id, args, m, services),
    handle = invoke(0x37e).value;
  for (const [offset, key, value] of [
    [32, '猫', 3],
    [64, 'a', 2],
    [96, 'A', 1],
  ]) {
    m.writeString(key, offset);
    invoke(0x380, [handle, offset, value]);
  }
  assert.equal(invoke(0x381, [handle, 64]).value, 2);
  for (const [index, expected] of ['A', 'a', '猫'].entries()) {
    assert.equal(invoke(0x386, [handle, index, 256]).value, 1);
    assert.equal(m.string(256), expected);
  }
  assert.equal(invoke(0x386, [handle, 0xffffffff, 256]).value, 0);
  assert.equal(m.string(256), '猫');
  const next = new NativeRuntime({ profile, read: async () => null });
  await next.restore(structuredClone(runtime.snapshot()));
  assert.equal(next.handles.get(handle, 'dictionary').get(Uint8Array.of(97)), 2);
  invoke(0x382, [handle]);
  assert.equal(invoke(0x383, [handle]).value, 4);
  invoke(0x37f, [handle]);
  assert.throws(() => invoke(0x381, [handle, 64]), /released/);
});

test('legacy dictionaries keep the first raw byte key, do not format it and retain -1 for missing names after restore', async () => {
  const runtime = new NativeRuntime({ profile, read: async () => null }),
    m = machine(),
    invoke = (id, args = []) => nativeDictionary(id, args, m, { handles: runtime.handles }),
    handle = invoke(0x203).value;
  m.bytes(0, 7).set([36, 115, 116, 114, 48, 0, 0]);
  m.bytes(32, 4).set([0x81, 0xff, 0, 1]);
  assert.equal(invoke(0x205, [handle, 0, 71]).control, 2);
  invoke(0x205, [handle, 0, 72]);
  invoke(0x205, [handle, 32, 81]);
  assert.equal(invoke(0x206, [handle, 0]).value, 71);
  assert.equal(invoke(0x206, [handle, 32]).value, 81);
  assert.equal(invoke(0x206, [handle, 64]).value, 0xffffffff);
  assert.equal(invoke(0x206, [0, 0xffffffff]).value, 0xffffffff);
  assert.equal(invoke(0x205, [0, 0xffffffff, 7]).control, 2);
  const restored = new NativeRuntime({ profile, read: async () => null });
  await restored.restore(structuredClone(runtime.snapshot()));
  assert.equal(nativeDictionary(0x206, [handle, 32], m, { handles: restored.handles }).value, 81);
  invoke(0x204, [handle]);
  assert.throws(() => invoke(0x206, [handle, 0]), /released/);
});

test('both dictionary families serialize into raw native heap memory and import it after fresh restore', async () => {
  for (const shift of [0, -9]) {
    const runtime = new NativeRuntime({ profile, read: async () => null }),
      m = machine(),
      heap = runtime.imageDataBuffers,
      services = {
        handles: runtime.handles,
        format: (at) => m.string(at),
        imageDataBuffers: () => heap,
      },
      invoke = (id, args = []) => nativeDictionary(id + shift, args, m, services),
      handle = invoke(0x37e).value;
    m.writeString('a', 64);
    m.writeString('猫', 128);
    invoke(0x380, [handle, 64, 19]);
    invoke(0x380, [handle, 128, 29]);
    const size = invoke(0x383, [handle]).value,
      pointer = (await nativeHeapData(0x341, [size], m, services)).value;
    heap.process.write(pointer, new Uint8Array(size).fill(0xa5));
    assert.throws(() => m.region(pointer, 1), /KCS memory/);
    assert.deepEqual(await invoke(0x384, [handle, pointer]), { control: 2 });
    const saved = runtime.snapshot(),
      fresh = new NativeRuntime({ profile, read: async () => null }),
      after = fresh.imageDataBuffers;
    await fresh.restore(saved);
    const next = { ...services, handles: fresh.handles, imageDataBuffers: () => after },
      restored = nativeDictionary(0x37e + shift, [], m, next).value;
    nativeDictionary(0x380 + shift, [restored, 64, 99], m, next);
    await nativeDictionary(0x385 + shift, [restored, pointer], m, next);
    assert.equal(nativeDictionary(0x381 + shift, [restored, 64], m, next).value, 99);
    assert.equal(nativeDictionary(0x381 + shift, [restored, 128], m, next).value, 29);
    assert.equal(nativeDictionary(0x386 + shift, [restored, 1, 256], m, next).value, 1);
    assert.equal(m.string(256), '猫');
    await nativeHeapData(0x342, [pointer], m, next);
    assert.equal(after.process.allocations.size, 0);
    assert.deepEqual(nativeDictionary(0x384 + shift, [0, pointer], m, {}), undefined);
    assert.deepEqual(nativeDictionary(0x384 + shift, [0, pointer], m, { handles: fresh.handles }), {
      control: 2,
    });
  }
});

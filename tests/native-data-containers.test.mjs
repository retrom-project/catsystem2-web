// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { dataWorld } from './fixtures/data-world.mjs';
import { NativeDataBuffers } from '../src/native/data-buffer.mjs';
import { NativeHandles } from '../src/native/handles.mjs';
import { NATIVE_ABIS } from '../src/native/abi/index.mjs';
import { hg3 } from './helpers.mjs';
for (const profile of Object.keys(NATIVE_ABIS))
  test(`${profile} image-data native sequence and shared restore without an EXE`, async () => {
    const rgba = Uint8Array.of(
        11,
        22,
        33,
        255,
        44,
        55,
        66,
        128,
        77,
        88,
        99,
        255,
        111,
        122,
        133,
        255,
      ),
      bytes = hg3(2, 2, rgba),
      world = await dataWorld(profile, { 'image.hg3': bytes }),
      fresh = await dataWorld(profile, { 'image.hg3': bytes }, { initialize: false }),
      invoke = (id, args) => world.runtime.native('main', id, args, world.main.machine, world.main),
      m = world.main.machine;
    try {
      m.writeString('image.hg3', 64);
      const handle = (await invoke(0x16d, [64])).value,
        buffers = world.runtime.imageDataBuffers,
        alias = buffers.alias(handle);
      assert.deepEqual(buffers.data(buffers.pointer(handle)), bytes);
      m.bytes(256, 40).fill(0xa5);
      assert.equal((await invoke(0x170, [handle, 0, 256])).value, 1);
      assert.deepEqual([...m.bytes(256, 8)], new Array(8).fill(0));
      assert.equal(m.load(264), 2);
      assert.equal(m.load(268), 2);
      assert.equal(m.load(280), 4);
      assert.equal(m.load(292), 0xa5a5a5a5);
      assert.equal((await invoke(0x170, [handle, 99, 256])).value, 0);
      assert.deepEqual([...m.bytes(256, 36)], new Array(36).fill(0));
      m.bytes(256, 40).fill(0xa5);
      assert.equal((await invoke(0x1af, [handle, 256])).value, 1);
      assert.equal(m.load(280), 0, '170/1AF pre-clear the untouched container DWORD');
      m.bytes(256, 40).fill(0xa5);
      assert.equal((await invoke(0x177, [64, 256])).value, 1);
      assert.equal(m.load(280), 4);
      const bitmap = (await invoke(0x16c, [handle, 0])).value;
      assert.deepEqual([...(await world.graphics.images.get(bitmap).pixels())], [...rgba]);
      assert.equal((await invoke(0x16c, [handle, 99])).value, 0);
      assert.equal((await invoke(0x170, [0, 0, 256])).value, 0);
      const before = m.bytes(256, 40).slice();
      assert.equal((await invoke(0x170, [handle, 0, 0xffffffff])).value, 0);
      assert.deepEqual(m.bytes(256, 40), before);
      await fresh.restore(structuredClone(world.snapshot()));
      const restored = fresh.runtime.imageDataBuffers;
      assert.equal(restored.pointer(handle), restored.pointer(alias));
      assert.deepEqual(restored.data(restored.pointer(alias)), bytes);
      await invoke(0x16e, [handle]);
      assert.deepEqual(buffers.data(buffers.pointer(alias)), bytes);
      await invoke(0x16e, [alias]);
      assert.throws(() => buffers.pointer(alias), /released/);
      assert.deepEqual(restored.data(restored.pointer(alias)), bytes);
      m.writeString('missing', 64);
      assert.equal((await invoke(0x16d, [64])).value, 0);
      assert.equal((await invoke(0x177, [64, 256])).value, 0);
      assert.deepEqual(await invoke(0x16e, [0]), { control: 2 });
      assert.ok(!world.nativeEngine);
    } finally {
      await world.close();
      await fresh.close();
    }
  });

test('canonical buffers reuse released spans without reviving consumed handles', () => {
  const handles = new NativeHandles(),
    buffers = new NativeDataBuffers({ handles }),
    bytes = new Uint8Array(1024),
    pointer = buffers.createPointer(bytes),
    handle = buffers.handle(pointer);
  buffers.releasePointer(pointer);
  const next = buffers.createPointer(bytes);
  assert.equal(next, pointer);
  assert.throws(() => buffers.pointer(handle), /released/);
  assert.throws(() => buffers.alias(handle), /released/);
  const limit = buffers.process.next;
  for (let i = 0; i < 8; i++) {
    buffers.releasePointer(pointer);
    assert.equal(buffers.createPointer(bytes), pointer);
  }
  assert.equal(buffers.process.next, limit);
});

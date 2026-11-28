// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { dataWorld } from './fixtures/data-world.mjs';
const profile = 'nekopara-vol3-engine-2.6.1.76';
test('record queue VM records survive a fresh World without an EXE', async () => {
  const first = await dataWorld(profile),
    fresh = await dataWorld(profile, {}, { initialize: false }),
    invoke = (world, id, args) =>
      world.runtime.native('main', id, args, world.main.machine, world.main);
  try {
    const handle = (await invoke(first, 0x3f2, [3])).value,
      m = first.main.machine,
      block = m.allocate(64),
      addresses = [0, 0x80000000, block];
    assert.equal((await invoke(first, 0x400, [0])).value, 1);
    assert.equal((await invoke(first, 0x400, [handle])).value, 1);
    assert.equal((await invoke(first, 0x3f5, [handle, 512])).value, 0);
    await invoke(first, 0x3f4, [handle, 0xffffffff]);
    for (let i = 0; i < 18; i++) {
      const at = addresses[i % 3];
      m.bytes(at, 3).set([i, i ^ 85, 255 - i]);
      await invoke(first, 0x3f4, [handle, at]);
    }
    await fresh.restore(structuredClone(first.snapshot()));
    for (let i = 0; i < 18; i++) {
      fresh.main.machine.bytes(512, 5).fill(0xa5);
      assert.equal((await invoke(fresh, 0x3f5, [handle, 512])).value, 1);
      assert.deepEqual([...fresh.main.machine.bytes(512, 5)], [i, i ^ 85, 255 - i, 0xa5, 0xa5]);
    }
    assert.equal((await invoke(fresh, 0x3f5, [handle, 512])).value, 0);
    assert.equal((await invoke(fresh, 0x400, [handle])).value, 1);
    assert.equal(first.runtime.handles.get(handle, 'record-queue').records.length, 18);
    assert.deepEqual(await invoke(fresh, 0x3f3, [handle]), { control: 2 });
    assert.throws(() => fresh.runtime.handles.get(handle, 'record-queue'), /released/);
    assert.ok(!first.nativeEngine);
    assert.ok(!fresh.nativeEngine);
  } finally {
    await fresh.close();
    await first.close();
  }
});

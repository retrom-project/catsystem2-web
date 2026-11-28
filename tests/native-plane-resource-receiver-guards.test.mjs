// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { dataWorld } from './fixtures/data-world.mjs';
import { floatBits } from '../src/kcs.mjs';
test('ordinary trail and tiling retain typed receiver guards without reading foreign payloads', async () => {
  const w = await dataWorld('bokutomo-engine-2.6.1.67');
  try {
    w.graphics.createLogicalDevice();
    const task = w.main,
      m = task.machine,
      call = (id, args) => w.runtime.native('main', id, args, m, task),
      base = await w.objects.create({ kind: 6, parent: task.id, name: 'unqualified trail Base' }),
      nativeBase = w.nativeTaskID(base),
      plane = await w.objects.create({ kind: 2, parent: task.id, name: 'qualified trail Plane' }),
      nativePlane = w.nativeTaskID(plane);
    m.bytes(128, 128).fill(0xa5);
    const before = m.memory.slice();
    const args = (id, target) =>
      id === 398
        ? [target, 1, 1, floatBits(1), floatBits(1), floatBits(1), 128, 0, 0, 0, 0, 0]
        : id === 399
          ? [target, 0x7ffffff0, 0x7ffffff0, 0x7ffffff0, 0x7ffffff0, 0xffffffff, 1]
          : [target, floatBits(8), floatBits(6), 1, 1];
    for (const target of [nativeBase, w.nativeTaskID(task.id), 0x3ffffffe])
      for (const id of [398, 399, 433])
        await assert.rejects(() => call(id, args(id, target)), /reviewed Plane receiver/);
    await assert.rejects(() => call(399, args(399, 0)), /reviewed Plane receiver/);
    assert.deepEqual(m.memory, before, 'guard must precede caller payload reads or writes');
    assert.deepEqual(await call(398, [0]), { control: 2 });
    assert.deepEqual(await call(433, [0]), { control: 2 });
    assert.deepEqual(await call(398, args(398, nativePlane)), { control: 2 });
    assert.equal(
      w.graphics.get(plane).state.trail,
      null,
      'actual empty kind2 takes the original no-model path',
    );
  } finally {
    await w.close({ flushFiles: false });
  }
});

// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { dataWorld } from './fixtures/data-world.mjs';

test('2.6.1.67 MOT filename query rejects a translated-null format before changing its working bank', async (t) => {
  const world = await dataWorld('bokutomo-engine-2.6.1.67');
  t.after(() => world.close({ flushFiles: false }));
  const registry = world.runtime.services.motion,
    handle = registry.create(world.main.id),
    manager = registry.get(handle),
    call = (owner, address) =>
      world.runtime.native('main', 514, [owner, address], world.main.machine, world.main);
  manager.base.fill(0x37);
  manager.working.fill(0xa1);
  for (const address of [0xefffffff, 0x40000000]) {
    assert.throws(() => call(handle, address), /original formatter reads NULL/);
    assert.deepEqual(manager.working, new Uint8Array(144).fill(0xa1));
    const reply = call(0, address);
    assert.equal(reply.control, 1);
    assert.equal(reply.value, 0);
  }
  // Guest address zero maps to actual VM data; it is not a native NULL pointer.
  world.main.machine.store(0, 0, 1);
  assert.equal(call(handle, 0).value, 0);
  assert.deepEqual(manager.working, manager.base);
});

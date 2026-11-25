// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { KCSMachine, readKCS } from '../src/kcs.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';

const profiles = [
  'bokutomo-engine-2.6.1.67',
  'rebellions-jp-engine-2.6.1.63',
  'grisaia-jp-engine-2.6.1.23',
];
async function invoke(world, id, args) {
  const task = world.main;
  task.status = 'ready';
  task.io = null;
  const machine = (task.machine = new KCSMachine(
    await readKCS(kcsProgram([[43, id, args.length * 4], [59]])),
    {
      native: (nativeID, values, vm) => world.runtime.scheduler.native(task, nativeID, values, vm),
    },
  ));
  machine.floor = machine.fp = 3584;
  machine.sp = 3588 + args.length * 4;
  machine.store(3584, 0x1234abcd);
  args.forEach((word, index) => machine.store(3588 + index * 4, word));
  assert.equal((await world.runtime.scheduler.execute(task)).status, 'halted');
  assert.equal(machine.sp, 3588);
  assert.equal(machine.load(3584), 0x1234abcd);
}

for (const profile of profiles) {
  test(`${profile} Sound group records retain duplicate, unsigned ID and cold owner semantics`, async () => {
    const program = kcsProgram([[43, 0, 0], [59]]);
    let world = await dataWorld(profile, { 'case.kcs': program });
    const audio = { channels: new Map(), stop() {} };
    world.sound.audio = audio;
    const groups = () => world.sound.primary(world.main.id).groups;
    groups().clear();
    try {
      await invoke(world, 602, [0xffffffff, 2, 31, 0, 0xffffffff]);
      await invoke(world, 602, [0xffffffff, 0, 1, 4, 50]);
      assert.deepEqual(groups().get(0xffffffff), {
        id: 0xffffffff,
        typeCode: 2,
        min: 31,
        max: 0,
        volume: 0xffffffff,
      });
      await invoke(world, 602, [0, 0xffffffff, 0xffffffff, 0x80000000, 100]);
      assert.equal(groups().get(0).min, -1);
      assert.equal(groups().get(0).max, -2147483648);
      const saved = structuredClone(world.snapshot());
      const cold = await dataWorld(profile, {}, { initialize: false });
      cold.sound.audio = audio;
      await cold.restore(saved);
      await world.close({ flushFiles: false });
      world = cold;
      assert.equal(groups().size, 2);
      await invoke(world, 603, [123]);
      assert.equal(groups().size, 2);
      await invoke(world, 603, [0xffffffff]);
      await invoke(world, 603, [0xffffffff]);
      assert.equal(groups().size, 1);
      await invoke(world, 602, [0xffffffff, 1, 0, 31, 73]);
      assert.equal(groups().get(0xffffffff).volume, 73);
    } finally {
      await world.close({ flushFiles: false });
    }
    assert.equal(world.sound.tasks.size, 0);
  });
}

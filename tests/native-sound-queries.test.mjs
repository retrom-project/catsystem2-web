// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { KCSMachine, readKCS } from '../src/kcs.mjs';
import { NATIVE_SOUND_CONTROL as C } from '../src/native/sound.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';

const profiles = [
  'bokutomo-engine-2.6.1.67',
  'rebellions-jp-engine-2.6.1.63',
  'grisaia-jp-engine-2.6.1.23',
];
const audio = () => ({ channels: new Map(), stop() {}, preload: async () => ({ buffer: {} }) });
async function invoke(world, id, bank) {
  const task = world.main;
  task.status = 'ready';
  task.io = null;
  const script = await readKCS(kcsProgram([[43, id, 4], [59]]));
  const machine = (task.machine = new KCSMachine(script, {
    native: (nativeID, args, vm) => world.runtime.scheduler.native(task, nativeID, args, vm),
  }));
  machine.floor = machine.fp = 3584;
  machine.sp = 3592;
  machine.store(3584, 0x1234abcd);
  machine.store(3588, bank);
  assert.equal((await world.runtime.scheduler.execute(task)).status, 'halted');
  assert.equal(machine.sp, 3592);
  assert.equal(machine.load(3584), 0x1234abcd);
  return machine.load(3588);
}

for (const profile of profiles) {
  test(`${profile} static decoder and completion queries retain raw words and native boundaries`, async () => {
    let world = await dataWorld(profile, { 'case.kcs': kcsProgram([[43, 0, 0], [59]]) });
    world.sound.audio = audio();
    try {
      const bank = world.sound.device[0];
      Object.assign(bank, {
        file: 'owned.wav',
        loaded: true,
        sourceMode: 'static',
        completionCount: 0x80000001,
        metadata: {
          codec: 'wav',
          channels: 1,
          bitsPerSample: 8,
          sampleRate: 1,
          pcmBytes: 0xffffffff,
        },
      });
      assert.equal(await invoke(world, 569, 0), 0xffffffff);
      assert.equal(await invoke(world, 587, 0), 0x80000001);
      bank.sourceMode = 'stream';
      assert.equal(await invoke(world, 569, 0), 0);
      assert.equal(await invoke(world, 587, 0), 0);
      bank.sourceMode = 'static';
      const saved = structuredClone(world.snapshot());
      const cold = await dataWorld(profile, {}, { initialize: false });
      cold.sound.audio = audio();
      await cold.restore(saved);
      await world.close({ flushFiles: false });
      world = cold;
      assert.equal(await invoke(world, 569, 0), 0xffffffff);
      assert.equal(await invoke(world, 587, 0), 0x80000001);
      assert.equal(await invoke(world, 569, 32), 0);
      await assert.rejects(invoke(world, 587, 32), /result uninitialized/);
      await assert.rejects(invoke(world, 587, 0xffffffff), /result uninitialized/);
      world.sound.audio = null;
      assert.equal(await invoke(world, 587, 32), 0);
    } finally {
      await world.close({ flushFiles: false });
    }
  });

  test(`${profile} pan readback and fade-pending preserve signed words and bank limits`, async () => {
    const world = await dataWorld(profile, { 'case.kcs': kcsProgram([[43, 0, 0], [59]]) });
    world.sound.audio = audio();
    try {
      const receiver = world.sound.primary(world.main.id);
      world.sound.device[0].pan = -100;
      assert.equal(await invoke(world, 165, 0), -100 >>> 0);
      assert.equal(await invoke(world, 165, 32), 0);
      for (const flags of [0, 1, 2, 3, 0x80000001]) {
        receiver.controls[0].word(C.flags, flags);
        assert.equal(await invoke(world, 349, 0), flags & 1);
        assert.equal(receiver.controls[0].word(C.flags), flags);
      }
      assert.equal(await invoke(world, 349, 32), 0);
    } finally {
      await world.close({ flushFiles: false });
    }
  });
}

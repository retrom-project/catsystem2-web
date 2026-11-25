// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { KCSMachine, readKCS } from '../src/kcs.mjs';
import { floatBits } from '../src/kcs/vm.mjs';
import { NATIVE_SOUND_CONTROL as C } from '../src/native/sound.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';

const profiles = [
  'bokutomo-engine-2.6.1.67',
  'rebellions-jp-engine-2.6.1.63',
  'grisaia-jp-engine-2.6.1.23',
];
const audio = () => ({ channels: new Map(), stop() {}, preload: async () => ({ buffer: {} }) });
async function invoke(world, id, ...args) {
  const task = world.main;
  task.status = 'ready';
  task.io = null;
  const script = await readKCS(kcsProgram([[43, id, args.length * 4], [59]]));
  const machine = (task.machine = new KCSMachine(script, {
    native: (nativeID, args, vm) => world.runtime.scheduler.native(task, nativeID, args, vm),
  }));
  machine.floor = machine.fp = 3584;
  machine.sp = 3588 + args.length * 4;
  machine.store(3584, 0x1234abcd);
  args.forEach((word, index) => machine.store(3588 + index * 4, word));
  assert.equal((await world.runtime.scheduler.execute(task)).status, 'halted');
  assert.equal(machine.sp, [166, 167, 168, 347, 348].includes(id) ? 3588 : 3592);
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
  test(`${profile} pan fades pack both fields and distance writes require a static buffer`, async () => {
    const world = await dataWorld(profile, { 'case.kcs': kcsProgram([[43, 0, 0], [59]]) });
    const output = [];
    world.sound.audio = {
      channels: new Map([['native:0', {}]]),
      stop() {},
      refresh() {},
      setNativeSpatial: (_key, state) => output.push(state),
    };
    try {
      const device = world.sound.device[0],
        receiver = world.sound.primary(world.main.id);
      Object.assign(device, { loaded: true, sourceMode: 'static', pan: -17 });
      Object.assign(device.nativeSpatial, {
        enabled: true,
        maximumDistance: 100,
        minimumDistance: 100,
      });
      receiver.frame = 17;
      world.configuration.soundOptions.use3d = 1;
      await invoke(world, 166, 0, 0x12348001, 0x1234ffff);
      const control = receiver.controls[0];
      assert.equal(control.word(C.flags) & 2, 2);
      assert.equal(control.float(C.targetPan), -32767);
      assert.equal(control.float(C.currentPan), -17);
      assert.equal(control.float(C.panRemaining), 65535);
      assert.equal(control.word(C.lastFrame), 17);
      await invoke(world, 167, 0, floatBits(999), floatBits(-0));
      assert.ok(Object.is(device.nativeSpatial.maximumDistance, -0));
      assert.equal(device.nativeSpatial.minimumDistance, 100);
      assert.equal(output.length, 1);
      device.sourceMode = 'stream';
      await invoke(world, 167, 0, floatBits(1), floatBits(25));
      assert.ok(Object.is(device.nativeSpatial.maximumDistance, -0));
      assert.equal(output.length, 1);
      await invoke(world, 168, 0, floatBits(1.25), floatBits(2.5), floatBits(4.5));
      await invoke(world, 347, 0, floatBits(-1.5), floatBits(2.25), floatBits(-3.5));
      await invoke(world, 348, 0, floatBits(0.5));
      assert.deepEqual(device.nativeSpatial.position, [0, 0, 0]);
      assert.deepEqual(device.nativeSpatial.velocity, [0, 0, 0]);
      assert.equal(device.nativeSpatial.dopplerFactor, 1);
      assert.equal(output.length, 1);
      device.sourceMode = 'static';
      device.loaded = false;
      await invoke(world, 167, 0, floatBits(1), floatBits(25));
      await invoke(world, 167, 32, floatBits(1), floatBits(25));
      assert.equal(output.length, 1);
    } finally {
      await world.close({ flushFiles: false });
    }
  });
}

// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioMixer } from '../src/audio.mjs';
import { KCSMachine, readKCS } from '../src/kcs.mjs';
import { floatBits } from '../src/kcs/vm.mjs';
import { nativeSoundPanPosition } from '../src/native/sound-values.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
import { audioFixture } from './fixtures/audio-context.mjs';
import { kcsProgram } from './helpers.mjs';

function wave() {
  const bytes = new Uint8Array(64044),
    view = new DataView(bytes.buffer);
  const text = (at, value) => bytes.set(new TextEncoder().encode(value), at);
  text(0, 'RIFF');
  view.setUint32(4, bytes.length - 8, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 8000, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  text(36, 'data');
  view.setUint32(40, 64000, true);
  for (let i = 44; i < bytes.length; i++) bytes[i] = ((i - 44) * 17 + 23) & 255;
  return bytes;
}
async function invoke(world, id, args) {
  const task = world.main;
  task.status = 'ready';
  task.io = null;
  const machine = (task.machine = new KCSMachine(
    await readKCS(kcsProgram([[43, id, args.length * 4], [59]], [[288, 'sound/owned.wav']])),
    {
      native: (nativeID, values, vm) => world.runtime.scheduler.native(task, nativeID, values, vm),
    },
  ));
  machine.floor = machine.fp = 3584;
  machine.sp = 3588 + args.length * 4;
  machine.store(3584, 0x1234abcd);
  args.forEach((word, i) => machine.store(3588 + i * 4, word));
  assert.equal((await world.runtime.scheduler.execute(task)).status, 'halted');
  assert.equal(machine.load(3584), 0x1234abcd);
  return machine.sp === 3592 ? machine.load(3588) : null;
}

test('2.6.1.67 Main155 creates both file modes under one audio service before queries and setters', async () => {
  const bytes = wave(),
    world = await dataWorld('bokutomo-engine-2.6.1.67', {
      'case.kcs': kcsProgram([[43, 0, 0], [59]]),
      'sound/owned.wav': bytes,
    });
  world.game.resolveCategory = (name) => (name === 'sound/owned.wav' ? name : null);
  const { context } = audioFixture();
  context.decodeAudioData = async (input) => {
    assert.deepEqual(new Uint8Array(input), bytes);
    return {
      sampleRate: 8000,
      numberOfChannels: 1,
      length: 64000,
      duration: 8,
      getChannelData: () => Float32Array.from(bytes.subarray(44), (value) => (value - 128) / 128),
    };
  };
  const mixer = new AudioMixer(world.game, context);
  world.audio = world.sound.audio = mixer;
  world.configuration.soundOptions.use3d = 1;
  try {
    for (const [bank, type, mode] of [
      [0, 1, 'stream'],
      [1, 2, 'static'],
    ]) {
      assert.equal(await invoke(world, 155, [bank, 0, 288, type]), 1);
      assert.equal(world.sound.audio, mixer);
      const device = world.sound.device[bank];
      assert.equal(device.sourceMode, mode);
      assert.deepEqual(device.nativeSpatial.position, nativeSoundPanPosition(0));
      assert.equal(await invoke(world, 569, [bank]), 64000);
      assert.equal(await invoke(world, 587, [bank]), 0);
      await invoke(world, 167, [bank, floatBits(8.25), floatBits(72.5)]);
      assert.equal(device.nativeSpatial.maximumDistance, 72.5);
      assert.equal(device.nativeSpatial.minimumDistance, 100);
      await invoke(world, 168, [bank, ...[1.25, 2.5, 4.5].map(floatBits)]);
      await invoke(world, 347, [bank, ...[-1.5, 2.25, -3.5].map(floatBits)]);
      await invoke(world, 348, [bank, floatBits(0.5)]);
      assert.deepEqual(device.nativeSpatial.position, [1.25, 2.5, 4.5]);
      assert.deepEqual(device.nativeSpatial.velocity, [-1.5, 2.25, -3.5]);
      assert.equal(device.nativeSpatial.dopplerFactor, 0.5);
      assert.equal(await invoke(world, 165, [bank]), 0);
      await invoke(world, 156, [bank]);
      assert.equal(device.loaded, false);
      assert.equal(await invoke(world, 569, [bank]), 0);
    }
  } finally {
    await world.close({ flushFiles: false });
  }
});

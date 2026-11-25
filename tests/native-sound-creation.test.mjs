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

function wave(frames = 64000) {
  const bytes = new Uint8Array(44 + frames),
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
  view.setUint32(40, frames, true);
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

for (const profile of [
  'bokutomo-engine-2.6.1.67',
  'rebellions-jp-engine-2.6.1.63',
  'grisaia-jp-engine-2.6.1.23',
])
  test(`${profile} draining stream pause, cold resume and stop retain native buffer ownership`, async () => {
    const bytes = wave(64500),
      files = {
        'case.kcs': kcsProgram([[43, 0, 0], [59]]),
        'sound/owned.wav': bytes,
      };
    const create = async (initialize = true) => {
      const world = await dataWorld(profile, files, { initialize }),
        { context } = audioFixture();
      world.game.resolveCategory = (name) => (name === 'sound/owned.wav' ? name : null);
      context.decodeAudioData = async () => ({
        sampleRate: 8000,
        numberOfChannels: 1,
        length: 64500,
        duration: 64500 / 8000,
        getChannelData: () => Float32Array.from(bytes.subarray(44), (value) => (value - 128) / 128),
      });
      world.audio = world.sound.audio = new AudioMixer(world.game, context);
      return { world, context };
    };
    let { world, context } = await create();
    try {
      await invoke(world, 155, [0, 0, 288, 1]);
      await invoke(world, 157, [0, 1]);
      context.advance(8.125);
      assert.equal(await invoke(world, 160, [0]), 1);
      assert.equal(world.sound.channel(0).nativeDraining, true);
      await invoke(world, 158, [0]);
      assert.equal(await invoke(world, 160, [0]), 0);
      const saved = structuredClone(world.snapshot()),
        cold = await create(false);
      await cold.world.restore(saved);
      await world.close({ flushFiles: false });
      ({ world, context } = cold);
      assert.equal(context.sources.length, 0);
      context.advance(0.125);
      assert.equal(await invoke(world, 160, [0]), 0);
      assert.equal(world.sound.channel(0).paused, true);
      await invoke(world, 157, [0, 1]);
      assert.equal(context.sources.length, 0);
      context.advance(0.25);
      assert.equal(await invoke(world, 160, [0]), 1);
      context.advance(0.125);
      assert.equal(await invoke(world, 160, [0]), 0);
      assert.equal(world.sound.channel(0).nativeDraining, false);
      await invoke(world, 155, [0, 0, 288, 1]);
      await invoke(world, 157, [0, 1]);
      context.advance(8.125);
      assert.equal(await invoke(world, 160, [0]), 1);
      await invoke(world, 159, [0]);
      context.advance(0.5);
      assert.equal(await invoke(world, 160, [0]), 0);
      await invoke(world, 155, [0, 0, 288, 2]);
      await invoke(world, 157, [0, 1]);
      context.advance(0.25);
      assert.equal(await invoke(world, 160, [0]), 1);
    } finally {
      await world.close({ flushFiles: false });
    }
  });

for (const profile of [
  'bokutomo-engine-2.6.1.67',
  'rebellions-jp-engine-2.6.1.63',
  'grisaia-jp-engine-2.6.1.23',
])
  test(`${profile} Main155 creates both file modes under one audio service before queries and setters`, async () => {
    const bytes = wave(),
      world = await dataWorld(profile, {
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
      world.sound.primary(world.main.id).groups.clear();
      await invoke(world, 602, [7, 0, 0, 2, 50]);
      const expected = profile.includes('.67') ? [0, 1, 2, 0] : [0, 1, 0xffffffff, 0xffffffff];
      for (const bank of expected) assert.equal(await invoke(world, 604, [7, 0, 288, 1, 1]), bank);
      assert.equal(await invoke(world, 604, [77, 0, 288, 1, 2]), 0xffffffff);
      await invoke(world, 156, [0]);
      assert.equal(await invoke(world, 604, [7, 0, 288, 1, 1]), 0);
      await assert.rejects(invoke(world, 604, [7, 0, 288, 1, 9]), /result uninitialized/);
      await invoke(world, 156, [0]);
      const receiver = world.sound.primary(world.main.id);
      await receiver.tick(11);
      assert.equal(await invoke(world, 569, [0]), 64000);
      await receiver.tick(12);
      assert.equal(await invoke(world, 569, [0]), 0);
      assert.equal(await invoke(world, 604, [7, 0, 288, 1, 1]), 0);
      await invoke(world, 157, [1, 1]);
      const raw = profile.includes('.67') ? 205 : profile.includes('.63') ? 204 : 197;
      await receiver.message([world.nativeTaskID(world.main.id), raw, 1, 0]);
      assert.equal(
        await invoke(world, 604, [7, 0, 288, 1, 1]),
        profile.includes('.67') ? 1 : 0xffffffff,
      );
    } finally {
      await world.close({ flushFiles: false });
    }
  });

for (const [profile, rawProperty, rawLevel] of [
  ['bokutomo-engine-2.6.1.67', 206, 207],
  ['rebellions-jp-engine-2.6.1.63', 205, 206],
])
  test(`${profile} stream refill preserves native partial-EOF activity through cold restore`, async () => {
    const bytes = wave(64500),
      files = {
        'case.kcs': kcsProgram([[43, 0, 0], [59]]),
        'sound/owned.wav': bytes,
      };
    const create = async (initialize = true) => {
      const world = await dataWorld(profile, files, { initialize }),
        { context } = audioFixture();
      world.game.resolveCategory = (name) => (name === 'sound/owned.wav' ? name : null);
      context.decodeAudioData = async () => ({
        sampleRate: 8000,
        numberOfChannels: 1,
        length: 64500,
        duration: 64500 / 8000,
        getChannelData: () => Float32Array.from(bytes.subarray(44), (value) => (value - 128) / 128),
      });
      world.audio = world.sound.audio = new AudioMixer(world.game, context);
      return { world, context };
    };
    let { world, context } = await create();
    const send = (raw, value = 0) =>
      world.sound
        .primary(world.main.id)
        .message([world.nativeTaskID(world.main.id), raw, 0, value]);
    try {
      await invoke(world, 155, [0, 0, 288, 1]);
      await send(rawProperty, 96);
      await invoke(world, 157, [0, 2]);
      for (let i = 0; i < 9; i++) {
        context.advance(0.5);
        await send(rawLevel);
      }
      assert.deepEqual(
        [...world.sound.channel(0).pcmWindows.values.subarray(0, 12)],
        [8035, 8035, 8177, 8035, 8177, 8035, 8177, 8035, 8035, 8126, 8177, 8035],
      );
      const saved = structuredClone(world.snapshot()),
        cold = await create(false);
      await cold.world.restore(saved);
      await world.close({ flushFiles: false });
      ({ world, context } = cold);
      context.advance(0.5);
      assert.equal(await send(rawLevel), 8035);
      assert.equal(world.sound.channel(0).pcmWindows.values[1], 0);
      context.advance(11.5);
      assert.equal(await invoke(world, 160, [0]), 0);
      assert.equal(world.sound.channel(0).offset, 0);
      assert.equal(await invoke(world, 587, [0]), 0);
      assert.deepEqual(
        [...world.sound.channel(0).pcmWindows.values.subarray(0, 4)],
        [8035, 8177, 8035, 8177],
      );
    } finally {
      await world.close({ flushFiles: false });
    }
  });

for (const profile of [
  'bokutomo-engine-2.6.1.67',
  'rebellions-jp-engine-2.6.1.63',
  'grisaia-jp-engine-2.6.1.23',
])
  test(`${profile} static completion repeats survive a cold world and stay in the reused bank`, async () => {
    const bytes = wave(),
      files = {
        'case.kcs': kcsProgram([[43, 0, 0], [59]]),
        'sound/owned.wav': bytes,
      };
    const create = async (initialize = true) => {
      const world = await dataWorld(profile, files, { initialize }),
        { context } = audioFixture();
      world.game.resolveCategory = (name) => (name === 'sound/owned.wav' ? name : null);
      context.decodeAudioData = async () => ({
        sampleRate: 8000,
        numberOfChannels: 1,
        length: 64000,
        duration: 8,
        getChannelData: () => Float32Array.from(bytes.subarray(44), (value) => (value - 128) / 128),
      });
      world.audio = world.sound.audio = new AudioMixer(world.game, context);
      return { world, context };
    };
    let { world, context } = await create();
    try {
      await invoke(world, 155, [1, 0, 288, 2]);
      await invoke(world, 157, [1, 3]);
      context.advance(8);
      assert.equal(await invoke(world, 587, [1]), 1);
      assert.equal(await invoke(world, 160, [1]), 1);
      const saved = structuredClone(world.snapshot()),
        cold = await create(false);
      await cold.world.restore(saved);
      await world.close({ flushFiles: false });
      ({ world, context } = cold);
      assert.equal(await invoke(world, 587, [1]), 1);
      assert.equal(world.sound.channel(1).loopCount, 2);
      context.advance(8);
      assert.equal(await invoke(world, 587, [1]), 2);
      assert.equal(await invoke(world, 160, [1]), 1);
      context.advance(8);
      assert.equal(await invoke(world, 587, [1]), 3);
      assert.equal(await invoke(world, 160, [1]), 0);
      assert.equal(world.sound.channel(1).offset, 0);
      await invoke(world, 156, [1]);
      assert.equal(await invoke(world, 587, [1]), 3);
      await invoke(world, 155, [1, 0, 288, 1]);
      assert.equal(world.sound.device[1].sourceMode, 'stream');
      assert.equal(await invoke(world, 587, [1]), 3);
      await invoke(world, 157, [1, 1]);
      assert.equal(await invoke(world, 587, [1]), 0);
      await invoke(world, 155, [1, 0, 288, 2]);
      await invoke(world, 157, [1, 0]);
      context.advance(8);
      context.advance(8);
      assert.equal(await invoke(world, 587, [1]), 2);
      assert.equal(await invoke(world, 160, [1]), 1);
      await invoke(world, 158, [1]);
      assert.equal(await invoke(world, 587, [1]), 2);
      assert.equal(await invoke(world, 160, [1]), 0);
      await invoke(world, 157, [1, 2]);
      assert.equal(await invoke(world, 587, [1]), 0);
      await invoke(world, 159, [1]);
      assert.equal(await invoke(world, 587, [1]), 0);
    } finally {
      await world.close({ flushFiles: false });
    }
  });

for (const profile of [
  'bokutomo-engine-2.6.1.67',
  'rebellions-jp-engine-2.6.1.63',
  'grisaia-jp-engine-2.6.1.23',
])
  test(`${profile} repeat changes retain drained PCM queues through cold restore`, async () => {
    const bytes = wave(64500),
      files = {
        'case.kcs': kcsProgram([[43, 0, 0], [59]]),
        'sound/owned.wav': bytes,
      };
    const create = async (initialize = true) => {
      const world = await dataWorld(profile, files, { initialize }),
        { context } = audioFixture();
      world.game.resolveCategory = (name) => (name === 'sound/owned.wav' ? name : null);
      context.decodeAudioData = async () => ({
        sampleRate: 8000,
        numberOfChannels: 1,
        length: 64500,
        duration: 64500 / 8000,
        getChannelData: () => Float32Array.from(bytes.subarray(44), (value) => (value - 128) / 128),
      });
      world.audio = world.sound.audio = new AudioMixer(world.game, context);
      return { world, context };
    };
    let { world, context } = await create();
    try {
      for (const repeat of [0, 2, 3]) {
        await invoke(world, 155, [0, 0, 288, 1]);
        await invoke(world, 157, [0, 1]);
        context.advance(8.125);
        assert.equal(await invoke(world, 160, [0]), 1);
        await invoke(world, 158, [0]);
        await invoke(world, 157, [0, repeat]);
        let channel = world.sound.channel(0);
        assert(channel.nativeStreamQueue);
        assert.equal(context.sources.at(-1).when - context.currentTime, 3.875);
        assert.equal(context.sources.at(-1).offset, 0);
        const saved = structuredClone(world.snapshot()),
          cold = await create(false);
        await cold.world.restore(saved);
        await world.close({ flushFiles: false });
        ({ world, context } = cold);
        channel = world.sound.channel(0);
        assert.equal(context.sources.at(-1).when, 3.875);
        const invalid = structuredClone(world.audio.snapshot());
        invalid.channels[0].nativeStreamQueue.count = -1;
        await assert.rejects(world.audio.restore(invalid), /PCM queue checkpoint/);
        assert.equal(world.sound.channel(0), channel);
        for (let n = 1; n <= 36; n++) {
          context.advance(0.5);
          const playing = await invoke(world, 160, [0]);
          if (repeat === 2 && n === 10) {
            await invoke(world, 158, [0]);
            assert.equal(await invoke(world, 160, [0]), 0);
            const paused = structuredClone(world.snapshot()),
              next = await create(false);
            await next.world.restore(paused);
            await world.close({ flushFiles: false });
            ({ world, context } = next);
            assert.equal(context.sources.length, 0);
            context.advance(0.25);
            await invoke(world, 157, [0, 2]);
            assert.equal(await invoke(world, 160, [0]), 1);
          }
          // Own PE callbacks retain the queued stream at the first partial
          // notification after its final decoded refill, then stop at the next.
          if (repeat === 2 && n === 33) assert.equal(playing, 1);
          if (repeat === 2 && n === 34) assert.equal(playing, 0);
        }
        assert.equal(await invoke(world, 160, [0]), Number(repeat === 0));
        if (repeat === 0) {
          await invoke(world, 155, [0, 0, 288, 2]);
          await invoke(world, 157, [0, 1]);
          context.advance(0.25);
          assert.equal(await invoke(world, 160, [0]), 1);
          assert.equal(world.sound.channel(0).nativeStreamQueue, null);
        }
        await invoke(world, 159, [0]);
        await invoke(world, 156, [0]);
        assert.equal(await invoke(world, 569, [0]), 0);
      }
    } finally {
      await world.close({ flushFiles: false });
    }
  });

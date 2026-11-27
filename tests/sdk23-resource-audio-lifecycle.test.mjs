// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { AudioMixer } from '../src/audio.mjs';
import { KCSMachine, readKCS } from '../src/kcs.mjs';
import { floatBits } from '../src/kcs/vm.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
import { audioFixture } from './fixtures/audio-context.mjs';
import { kcsProgram } from './helpers.mjs';

const golden = JSON.parse(
  await readFile(new URL('./fixtures/sdk23-resource-audio-primary-golden.json', import.meta.url)),
);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
function wave() {
  const bytes = new Uint8Array(64044),
    view = new DataView(bytes.buffer),
    text = (at, value) => bytes.set(new TextEncoder().encode(value), at);
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

async function open(initialize = true) {
  const wav = wave(),
    world = await dataWorld(
      golden.profile,
      { 'case.kcs': kcsProgram([[59]]), 'sound/owned.wav': wav },
      { initialize },
    ),
    { context } = audioFixture(),
    reads = [];
  world.game.resolveCategory = (name, category) => {
    assert.equal(category, 'sound');
    return name === 'sound/owned.wav' ? name : null;
  };
  context.sampleRate = 8000;
  context.decodeAudioData = async (input) => {
    assert.equal(sha(new Uint8Array(input)), sha(wav));
    reads.push(sha(new Uint8Array(input)));
    const samples = Float32Array.from(wav.subarray(44), (value) => (value - 128) / 128);
    return {
      sampleRate: 8000,
      numberOfChannels: 1,
      length: samples.length,
      duration: 8,
      getChannelData(index) {
        assert.equal(index, 0);
        return samples;
      },
    };
  };
  world.audio = world.sound.audio = new AudioMixer(world.game, context);
  world.configuration.soundOptions.use3d = 1;
  return { world, context, reads, wav };
}

async function invoke(world, row) {
  const task = world.main,
    previous = { machine: task.machine, status: task.status, io: task.io };
  task.status = 'ready';
  task.io = null;
  const machine = (task.machine = new KCSMachine(
    await readKCS(
      kcsProgram([[43, row.id, row.args.length * 4], [59]], [[288, 'sound/owned.wav']]),
    ),
    { native: (id, args, vm) => world.runtime.scheduler.native(task, id, args, vm) },
  ));
  machine.floor = machine.fp = 3584;
  machine.sp = 3588 + row.args.length * 4;
  machine.store(3584, 0x67c569a5);
  row.args.forEach((word, i) => machine.store(3588 + i * 4, word));
  try {
    assert.equal((await world.runtime.scheduler.execute(task)).status, 'halted');
    assert.equal(machine.load(3584), 0x67c569a5, 'GCALL preserves its caller canary');
    const control = machine.sp === 3592 ? 1 : machine.sp === 3588 ? 2 : null;
    assert.equal(control, row.control, row.name);
    assert.equal(control === 1 ? machine.load(3588) : null, row.result, row.name);
  } finally {
    Object.assign(task, previous);
  }
}

function compare(world, row, group) {
  for (const expected of row.banks) {
    const device = world.sound.device[expected.bank],
      channel = world.sound.channel(expected.bank);
    assert.equal(Number(device.loaded), expected.loaded, row.name);
    assert.equal(channel?.completionCount ?? device.completionCount, expected.completion, row.name);
    for (const key of ['maximumDistance', 'minimumDistance', 'dopplerFactor']) {
      const name = {
        maximumDistance: 'maximum',
        minimumDistance: 'minimum',
        dopplerFactor: 'doppler',
      }[key];
      assert.equal(floatBits(device.nativeSpatial[key]), expected[name], row.name);
    }
    for (const key of ['position', 'velocity'])
      assert.deepEqual(device.nativeSpatial[key].map(floatBits), expected[key], row.name);
    if (group === 'static') {
      assert.equal(Number(Boolean(channel?.playing)), expected.active, row.name);
      if (channel) assert.equal(channel.loopCount, expected.remainingLoops, row.name);
    } else
      assert.deepEqual(
        Array.from({ length: 18 }, (_, i) =>
          world.sound.primary(world.main.id).controls[expected.bank].word(i * 4),
        ),
        expected.control,
        row.name,
      );
  }
}

for (const [group, coldPoints] of [
  ['static', [4, 15, 19, 35]],
  ['group', [3, 19, 21, 23]],
  ['controls', [9, 11]],
])
  for (const coldAt of [null, ...coldPoints])
    test(`SDK23 primary ${group} original GCALL chain${coldAt === null ? '' : `, independent cold${coldAt}`}`, async () => {
      let opened = await open(),
        { world } = opened;
      const fixture = golden.groups[group];
      assert.equal(sha(opened.wav), fixture.fixtureSha256);
      if (group === 'group') world.sound.primary(world.main.id).groups.clear();
      try {
        for (const [index, row] of fixture.rows.entries()) {
          for (const action of row.beforeActions ?? []) {
            if (action.kind === 'static-completion-notification') {
              const channel = world.sound.channel(action.bank);
              assert(channel.source?.onended, 'the actual mixer source owns completion');
              channel.source.onended();
            } else if (action.kind === 'sound-frame')
              await world.sound.primary(world.main.id).tick(action.frame);
            else {
              assert.equal(action.kind, 'sound-message');
              await world.sound
                .primary(world.main.id)
                .message([world.nativeTaskID(world.main.id), action.raw, action.bank, 0]);
            }
          }
          await invoke(world, row);
          compare(world, row, group);
          if (index === coldAt) {
            const state = structuredClone(world.snapshot());
            await world.close({ flushFiles: false });
            opened = await open(false);
            world = opened.world;
            await world.restore(state);
            compare(world, row, group);
          }
        }
        assert(opened.reads.length > 0, 'decoded real authored WAV bytes reach the mixer');
      } finally {
        await world.close({ flushFiles: false });
      }
      assert.equal(world.sound.tasks.size, 0);
      assert.equal(world.audio.channels.size, 0);
    });

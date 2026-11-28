// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { AudioMixer } from '../src/audio.mjs';
import { decodeNativeMSADPCM, NativePCMQueue, NativePCMWindows } from '../src/native/audio-pcm.mjs';
import { KCSMachine, readKCS } from '../src/kcs.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
import { audioFixture } from './fixtures/audio-context.mjs';
import { kcsProgram } from './helpers.mjs';

const golden = JSON.parse(
  await readFile(new URL('./fixtures/native-ms-adpcm-io-golden.json', import.meta.url)),
);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

for (const suite of golden.cases)
  for (const [version, profile] of [
    ['63', 'rebellions-jp-engine-2.6.1.63'],
    ['67', 'bokutomo-engine-2.6.1.67'],
  ])
    test(`${profile} ${suite.name} MS ADPCM output and ownership match original through cold`, async () => {
      const bytes = Uint8Array.from(Buffer.from(suite.wav, 'base64')),
        files = { 'case.kcs': kcsProgram([[43, 0, 0], [59]]), 'sound/owned.wav': bytes };
      assert.equal(sha(bytes), suite.wavSha256);
      let world,
        mixer,
        context,
        cold = 0;
      const create = async (initialize = true) => {
        const next = await dataWorld(profile, files, { initialize }),
          host = audioFixture();
        next.game.resolveCategory = (name, category) =>
          name === 'sound/owned.wav'
            ? name
            : name === 'owned' && category === 'tag'
              ? 'tag/owned.tag'
              : null;
        host.context.decodeAudioData = async () => {
          throw new Error('The native MS ADPCM path must not delegate to browser decoding');
        };
        const audio = new AudioMixer(next.game, host.context);
        next.audio = next.sound.audio = audio;
        next.configuration.soundOptions.use3d = 1;
        return { world: next, mixer: audio, context: host.context };
      };
      ({ world, mixer, context } = await create());
      world.sound.primary(world.main.id).groups.clear();
      const output = (channel) => {
        const source = channel.source,
          elapsed = source ? (context.currentTime - source.when) * source.playbackRate.value : -1,
          result = [];
        for (let sample = 0; sample < 8; sample++) {
          let frame = source
            ? Math.floor((source.offset + elapsed) * suite.sampleRate) + sample
            : -1;
          if (source?.loop && frame >= Math.round(source.loopEnd * suite.sampleRate)) {
            const start = Math.round(source.loopStart * suite.sampleRate),
              end = Math.round(source.loopEnd * suite.sampleRate);
            frame = start + ((frame - end) % (end - start));
          }
          for (let channel = 0; channel < suite.channels; channel++) {
            const value =
                source && !source.stopped && elapsed >= 0
                  ? (source.buffer.getChannelData(channel)[frame] ?? 0)
                  : 0,
              word = Math.round(value * 32768);
            result.push(word & 255, (word >> 8) & 255);
          }
        }
        return result;
      };
      try {
        for (const row of suite.versions[version].rows) {
          for (const action of row.beforeActions ?? [])
            if (action.kind === 'sound-message')
              await world.sound
                .primary(world.main.id)
                .message([
                  world.nativeTaskID(world.main.id),
                  action.raw,
                  action.bank,
                  action.l ?? 0,
                ]);
            else if (action.kind === 'sound-frame')
              await world.sound.primary(world.main.id).tick(action.frame);
            else {
              context.advance(action.seconds);
              const channel = mixer.channels.get('native:0');
              if (channel) mixer.syncNativePCM(channel);
            }
          const task = world.main;
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
          row.args.forEach((word, index) => machine.store(3588 + index * 4, word));
          assert.equal((await world.runtime.scheduler.execute(task)).status, 'halted', row.name);
          assert.equal(machine.load(3584), 0x67c569a5);
          assert.equal(machine.sp, row.control === 1 ? 3592 : 3588, row.name);
          if (row.control === 1) assert.equal(machine.load(3588), row.result, row.name);
          for (const expected of row.banks) {
            const key = `native:${expected.bank}`,
              device = world.sound.device[expected.bank],
              channel = mixer.channels.get(key),
              state = device.nativeDecoderBuffer,
              record = mixer.nativeDecoderBuffers.get(key),
              ring =
                channel?.nativeStreamQueue?.ring ??
                state?.queue?.ring ??
                (record && mixer.pcmSources.get(record.buffer)?.pcm),
              activity = channel?.pcmWindows.values ?? state?.activity;
            assert.equal(Number(device.loaded), expected.loaded, row.name);
            if (ring) assert.equal(sha(ring), expected.ringSha256, row.name);
            if (activity)
              assert.equal(sha(JSON.stringify([...activity])), expected.activitySha256, row.name);
            if (channel) {
              assert.equal(Number(channel.playing), expected.active, row.name);
              assert.equal(channel.completionCount, expected.completion, row.name);
              if (channel.playing || channel.paused)
                assert.equal(channel.loopCount, expected.remainingLoops, row.name);
              assert.deepEqual(output(channel), expected.nextPCM, row.name);
            }
          }
          for (let bank = 0; bank < 4; bank++)
            if (!row.banks.some((expected) => expected.bank === bank))
              assert.equal(world.sound.device[bank].loaded, false, row.name);
          if (suite.coldAfterNames.includes(row.name)) {
            const saved = structuredClone(world.snapshot()),
              next = await create(false);
            await next.world.restore(saved);
            await world.close({ flushFiles: false });
            ({ world, mixer, context } = next);
            cold++;
          }
        }
        assert.equal(cold, suite.coldCount);
      } finally {
        await world.close({ flushFiles: false });
      }
    });

test('native MS ADPCM queue rejects unaligned checkpoint offsets and span-crossing header reads', () => {
  const stereo = golden.cases.find((suite) => suite.name === 'stereo11025'),
    source = decodeNativeMSADPCM(Uint8Array.from(Buffer.from(stereo.wav, 'base64'))),
    windows = new NativePCMWindows(source),
    base = new NativePCMQueue(source, windows, {
      progress: 0,
      origin: 0,
      refills: 0,
      count: 0,
      loopStart: 0,
      prefixBytes: 0,
    }),
    snapshot = base.snapshot();
  for (const badOffset of [1, 2, source.blockStarts[0] + 6])
    assert.throws(
      () =>
        new NativePCMQueue(
          source,
          windows,
          { progress: 0, origin: 0, refills: 0, count: 0, loopStart: 0 },
          { ...snapshot, decoderByte: badOffset },
        ),
      /Invalid native PCM queue checkpoint/,
    );
  const headQueue = new NativePCMQueue(
    source,
    windows,
    { progress: 0, origin: 0, refills: 0, count: 0, loopStart: 0 },
    { ...snapshot, decoderByte: 0, prefixRemaining: 0 },
  );
  assert.throws(
    () => headQueue.read(2, source.pcm.length),
    /Native MS ADPCM read exceeds its owning locked byte span/,
  );
});

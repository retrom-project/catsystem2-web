// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { MotionLibrary } from '../src/motion/library.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { NativeWorld } from '../src/native/world.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { kcsProgram, memoryGame } from './helpers.mjs';

test(
  'original SDK CsSound sends its group lookup, load, volume and play to the same sound bank',
  { skip: !process.env.CATSYSTEM2_SDK_EXE },
  async () => {
    const profile = 'sdk-4.01-engine-2.6.1.74',
      executable = await readFile(process.env.CATSYSTEM2_SDK_EXE),
      file = 'bgm/cue.wav',
      script = new TextEncoder().encode(
        'var sound = new CsSound(); sound.load("cue.wav", "bgm"); sound.play(2);',
      ),
      own = [37, [0x14, 64]],
      target = [37, [0x14, 68]],
      program = kcsProgram(
        [
          [37, 0],
          [37, 0],
          [37, 3],
          [37, 3],
          [37, 100],
          [43, 0x25a, 20],
          [43, 0x44, 0],
          [38, 64],
          [37, 55],
          own,
          [37, 256],
          [43, 0x42, 12],
          [38, 68],
          target,
          own,
          [43, 0x3ce, 8],
          target,
          [37, 288],
          [43, 0x3cf, 8],
          [59],
        ],
        [
          [256, 'Authored Sound'],
          [288, 'sound.js'],
        ],
      ),
      game = memoryGame({ 'engine.exe': executable, 'main.kcs': program, 'sound.js': script }),
      random = new ParticleRandom(19),
      audio = {
        channels: new Map(),
        async preload(name) {
          return name === file ? { metadata: { channels: 2 } } : null;
        },
        async play(channel) {
          this.channels.set(channel.channel, { ...channel, playing: true });
          return this.channels.get(channel.channel);
        },
        pause(key) {
          const channel = this.channels.get(key);
          if (channel) Object.assign(channel, { playing: false, paused: true });
        },
        setNativeSpatial() {},
        refresh() {},
        stop(key) {
          this.channels.delete(key);
        },
      };
    game.nativeResources = {
      resolve(name, kind) {
        if (kind === 'javascript' && name === 'sound.js') return name;
        if (kind === 'sound' && name === 'cue.wav') return file;
        return null;
      },
    };
    const world = new NativeWorld({
      game,
      profile,
      configuration: new NativeConfiguration({ profile, uiLanguage: 0x411 }),
      random,
      images: {},
      host: {},
      audio,
      bootstrapOwner: { embeddedJavaScript: true },
      motionLibrary: new MotionLibrary(game, { profile, random }),
      storage: { read: (name) => game.read(name), write: async () => true },
    });
    try {
      world.root = await world.objects.create({ kind: 1, name: 'Authored Top' });
      world.main = await world.spawnScript('main.kcs');
      await world.tick();
      const task = [...world.objects.objects.values()].find((record) => record.kind === 55);
      assert.equal(world.nativeEngine.process.load(task.implementation.pointer + 140), 1);
      assert.deepEqual([...audio.channels.keys()], ['native:3']);
      const channel = audio.channels.get('native:3');
      assert.equal(channel.file, file);
      assert.equal(channel.loopCount, 2);
      assert.equal(channel.volume, 100);
      assert.equal(world.sound.device[3].loaded, true);
    } finally {
      await world.close();
    }
    assert.equal(audio.channels.size, 0);
  },
);

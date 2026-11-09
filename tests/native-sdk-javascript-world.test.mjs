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
  'SDK KCS links, loads and advances an original JavaScript task through fresh World restore',
  { skip: !process.env.CATSYSTEM2_SDK_EXE },
  async () => {
    const profile = 'sdk-4.01-engine-2.6.1.74',
      executable = await readFile(process.env.CATSYSTEM2_SDK_EXE),
      script = new TextEncoder().encode(
        'var next = (function () { var count = 0; return function () { return ++count; }; }());\n' +
          'function GameLoop(frame) { if (next() === 2) cfExit(42); }',
      ),
      own = [37, [0x14, 64]],
      target = [37, [0x14, 68]],
      start = [
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
        target,
        [37, 7],
        [43, 0x3ee, 8],
      ],
      idle = start.reduce((pc, op) => pc + 1 + (op.length - 1) * 5, 0),
      program = kcsProgram(
        [...start, [43, 0x41, 0], [41, idle]],
        [
          [256, 'Authored JavaScript'],
          [288, 'authored.js'],
        ],
      ),
      make = () => {
        const game = memoryGame({
            'engine.exe': executable,
            'main.kcs': program,
            'authored.js': script,
          }),
          random = new ParticleRandom(17);
        return new NativeWorld({
          game,
          profile,
          configuration: new NativeConfiguration({ profile, uiLanguage: 0x411 }),
          random,
          images: {},
          host: {},
          bootstrapOwner: { embeddedJavaScript: true },
          motionLibrary: new MotionLibrary(game, { profile, random }),
          storage: { read: (name) => game.read(name), write: async () => true },
        });
      },
      world = make();
    let fresh;
    try {
      world.root = await world.objects.create({ kind: 1, name: 'Authored Top' });
      world.main = await world.spawnScript('main.kcs');
      await world.tick();
      const targetNativeID = world.main.machine.load(68),
        id = world.resolveTaskID(targetNativeID, world.main.id),
        p = world.nativeEngine.process,
        record = world.objects.objects.get(id),
        pointer = record.implementation.pointer;
      assert.equal(record.kind, 55);
      assert.equal(record.parent, world.main.id);
      assert.equal(p.load(pointer), 0x9984c0);
      assert.equal(p.load(pointer + 156), world.nativeTaskID(world.main.id));
      assert.equal(p.load(pointer + 608), 7);
      assert.equal(p.load(pointer + 140), 1, 'the original V8 load succeeded');
      const input = world.resolveTaskID(p.load(pointer + 192), id);
      assert.equal(world.objects.objects.get(input).parent, id);
      assert.equal(world.objects.objects.get(input).kind, 6);
      await world.tick();
      assert.equal(record.exitCode, -1);
      fresh = make();
      await fresh.restore(structuredClone(world.snapshot()));
      await fresh.tick();
      assert.equal(fresh.objects.objects.get(id).exitCode, 42);
      assert.equal(fresh.nativeEngine.process.load(pointer + 144), 0);
      assert.equal(record.exitCode, -1);
      await world.tick();
      assert.equal(record.exitCode, 42);
    } finally {
      await fresh?.close();
      await world.close();
    }
  },
);

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
  'SDK KCS links, loads and calls original JavaScript with shared banks across restore',
  { skip: !process.env.CATSYSTEM2_SDK_EXE },
  async () => {
    const profile = 'sdk-4.01-engine-2.6.1.74',
      executable = await readFile(process.env.CATSYSTEM2_SDK_EXE),
      script = new TextEncoder().encode(
        'var next = (function () { var count = 0; return function () { return ++count; }; }());\n' +
          'var ready = false;\n' +
          'function Enable(args) {\n' +
          '  var s = args[0], missing = args[1];\n' +
          '  var words = cfGetStrVar(100, 2);\n' +
          '  var values = cfGetVar(3, 2);\n' +
          '  if (s === "\\u65e5\\u672c" && missing === "" && words[0] === s && words[1] === missing\n' +
          '      && values[0] === -11 && values[1] === 17 && cfGetVar(-1) === 0) {\n' +
          '    cfSetStrVar(102, "\\u78ba\\u8a8d");\n' +
          '    cfSetStrVar(103, "");\n' +
          '    cfSetVar(4, 23);\n' +
          '    ready = true;\n' +
          '  }\n' +
          '}\n' +
          'function GameLoop(frame) {\n' +
          '  if (ready && next() === 2 && cfGetStrVar(100) === "updated"\n' +
          '      && cfCalc("$4 += 7") === 30 && cfCalc("$5 = $$8 + bonus") === 24\n' +
          '      && cfCalc("$$8 += 2") === 22 && cfGetVar(5) === 24) {\n' +
          '    cfSetStrVar(104, "complete"); cfExit(42);\n' +
          '  }\n' +
          '}',
      ),
      own = [37, [0x14, 64]],
      target = [37, [0x14, 68]],
      start = [
        [37, 16],
        [43, 0xd1, 4],
        [37, 3],
        [37, -11],
        [43, 0xd3, 8],
        [37, 4],
        [37, 17],
        [43, 0xd3, 8],
        [37, 100],
        [37, 320],
        [43, 0x114, 8],
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
        target,
        [37, 352],
        [37, 100],
        [37, 2],
        [43, 0x3d0, 16],
        [37, 102],
        [37, 96],
        [43, 0x115, 8],
        [37, 4],
        [43, 0xd2, 4],
        [38, 108],
      ],
      idle = start.reduce((pc, op) => pc + 1 + (op.length - 1) * 5, 0),
      program = kcsProgram(
        [...start, [43, 0x41, 0], [41, idle]],
        [
          [256, 'Authored JavaScript'],
          [288, 'authored.js'],
          [320, '日本'],
          [352, 'Enable'],
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
      assert.equal(world.main.machine.string(96), '確認');
      assert.equal(world.main.machine.load(108), 23);
      const bank = world.runtime.stringBank(world.main, false),
        variables = world.runtime.variableBank(world.main, false);
      assert.equal(bank.get(103), '');
      const input = world.resolveTaskID(p.load(pointer + 192), id);
      assert.equal(world.objects.objects.get(input).parent, id);
      assert.equal(world.objects.objects.get(input).kind, 6);
      await world.tick();
      assert.equal(record.exitCode, -1);
      bank.set(100, 'updated');
      variables.registerContext(world.main.id);
      variables.setPrivate(8, 20);
      variables.setName('bonus', 0, 4);
      fresh = make();
      await fresh.restore(structuredClone(world.snapshot()));
      await fresh.tick();
      assert.equal(fresh.objects.objects.get(id).exitCode, 42);
      assert.equal(fresh.runtime.stringBank(fresh.main, false).get(104), 'complete');
      const restoredVariables = fresh.runtime.variableBank(fresh.main, false);
      assert.equal(restoredVariables.get(4), 30);
      assert.equal(restoredVariables.get(5), 24);
      assert.equal(restoredVariables.getPrivate(8), 22);
      assert.equal(fresh.nativeEngine.process.load(pointer + 144), 0);
      assert.equal(record.exitCode, -1);
      await world.tick();
      assert.equal(record.exitCode, 42);
      assert.equal(bank.get(104), 'complete');
      assert.deepEqual(variables.snapshot(), restoredVariables.snapshot());
    } finally {
      await fresh?.close();
      await world.close();
    }
  },
);

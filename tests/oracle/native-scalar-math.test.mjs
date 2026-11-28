// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { verifyScalarMath } from '../../scripts/verify-native-scalar-math.mjs';
import { verifyWordUnpacking } from '../../scripts/verify-native-word-unpack.mjs';
import { NativeWorld } from '../../web/transitional-entry.mjs';
import { NativeConfiguration } from '../../src/native/config.mjs';
import { MotionLibrary } from '../../src/motion/library.mjs';
import { ParticleRandom } from '../../src/ppi/random.mjs';
import { invokeNative } from '../../oracle/scalar-invoke.mjs';
import { nativeABI } from '../../src/native/abi/index.mjs';
import { floatBits } from '../../src/kcs.mjs';
import { kcsProgram, memoryGame } from '../helpers.mjs';

for (const [profile, variable] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
]) {
  test(
    `${profile} scalar math retains original result words and full floating-point context`,
    { skip: !process.env[variable] },
    async () => {
      await verifyScalarMath(new Uint8Array(await readFile(process.env[variable])), profile);
    },
  );
  test(
    `${profile} signed word unpacking preserves all original VM bytes and alias order`,
    { skip: !process.env[variable] },
    async () => {
      await verifyWordUnpacking(new Uint8Array(await readFile(process.env[variable])), profile);
    },
  );
}

test(
  'SDK oracle preserves plugin-modified floating-point context through a fresh World',
  { skip: !process.env.CATSYSTEM2_SDK_EXE },
  async () => {
    const exe = new Uint8Array(await readFile(process.env.CATSYSTEM2_SDK_EXE)),
      profile = 'sdk-4.01-engine-2.6.1.74',
      make = () => {
        const game = memoryGame({
            'engine.exe': exe,
            'main.kcs': kcsProgram([[37, 128], [43, 0xd1, 4], [59]]),
          }),
          configuration = new NativeConfiguration({ profile }),
          random = new ParticleRandom();
        game.width = 64;
        game.height = 48;
        Object.assign(configuration.screen, {
          width: 64,
          height: 48,
          currentWidth: 64,
          currentHeight: 48,
          virtualWidth: 64,
          virtualHeight: 48,
        });
        return new NativeWorld({
          game,
          configuration,
          random,
          profile,
          images: {},
          host: {},
          motionLibrary: new MotionLibrary(game, { profile, random }),
          storage: { read: async () => null, write: async () => true },
        });
      },
      world = make();
    let fresh;
    try {
      await world.initialize('main.kcs');
      const task = world.main,
        m = task.machine,
        p = world.nativeEngine.process,
        call = (id, args) =>
          invokeNative(nativeABI(profile).tables.main.entries[id].name, {
            engine: world.nativeEngine,
            world,
            args,
            machine: m,
            task,
          });
      p.cpu.reg_write_i32(p.uc.X86_REG_FPCW, 0xb7f);
      p.cpu.reg_write_i32(p.uc.X86_REG_MXCSR, 0x5f80);
      assert.equal(
        (await call(0x3c, [floatBits(2)])).value,
        0x3fb504f4,
        'the original upward-rounded square root differs from host round-to-nearest',
      );
      assert.equal((await call(0x36a, [0xabcd1234, 0xef987654])).value, 0x76541234);
      assert.equal((await call(0x1cd, [floatBits(10)])).value, floatBits(1));
      for (const [phase, period, expected] of [
        [0, 4, 0],
        [1, 4, 1],
        [2, 4, -0],
        [3, 4, -1],
        [4, 4, 0],
        [-1, 4, 1],
        [1, -4, 1],
        [5, 4, 1],
        [6, 4, -0],
        [7, 4, -1],
        [8, 4, 0],
      ])
        assert.equal(
          (await call(0x141, [floatBits(phase), floatBits(period)])).value,
          floatBits(expected),
          `original triangle phase ${phase}, period ${period}`,
        );
      const block = m.allocate(16);
      assert.deepEqual(await call(0x36b, [0x8000ffff, 256, 0x80000010]), { control: 2 });
      assert.equal(m.load(256), 0xffffffff);
      assert.equal(m.load(0x80000010), 0xffff8000);
      const savedCW = p.cpu.reg_read_i32(p.uc.X86_REG_FPCW),
        savedMXCSR = p.cpu.reg_read_i32(p.uc.X86_REG_MXCSR);
      fresh = make();
      await fresh.restore(structuredClone(world.snapshot()));
      const fp = fresh.nativeEngine.process,
        ft = fresh.main,
        fm = ft.machine,
        invoke = (id, args) =>
          invokeNative(nativeABI(profile).tables.main.entries[id].name, {
            engine: fresh.nativeEngine,
            world: fresh,
            args,
            machine: fm,
            task: ft,
          });
      assert.equal(fp.cpu.reg_read_i32(fp.uc.X86_REG_FPCW), savedCW);
      assert.equal(fp.cpu.reg_read_i32(fp.uc.X86_REG_MXCSR), savedMXCSR);
      assert.equal(fm.load(256), 0xffffffff);
      assert.equal(fm.load(0x80000010), 0xffff8000);
      assert.deepEqual(await invoke(0x36b, [0x7fff1234, 0x80000010, block]), { control: 2 });
      assert.equal(fm.load(0x80000010), 0x1234);
      assert.equal(fm.load(block), 0x7fff);
      assert.equal(m.load(0x80000010), 0xffff8000);
      assert.equal(m.load(block), 0);
      assert.equal((await invoke(0x3c, [floatBits(2)])).value, 0x3fb504f4);
      assert.equal((await invoke(0x141, [floatBits(0.75), floatBits(2)])).value, floatBits(0.5));
      fp.cpu.reg_write_i32(fp.uc.X86_REG_FPCW, 0x37f);
      fp.cpu.reg_write_i32(fp.uc.X86_REG_MXCSR, 0x1f80);
      assert.equal((await invoke(0x3c, [floatBits(2)])).value, 0x3fb504f3);
      assert.equal(p.cpu.reg_read_i32(p.uc.X86_REG_FPCW), savedCW);
      assert.equal((await call(0x3c, [floatBits(2)])).value, 0x3fb504f4);
    } finally {
      await fresh?.close({ flushFiles: false });
      await world.close({ flushFiles: false });
    }
  },
);

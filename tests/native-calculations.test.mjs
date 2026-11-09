// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeWorld } from '../src/native/world.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { floatBits, bitsFloat } from '../src/kcs.mjs';
import { memoryGame, kcsProgram } from './helpers.mjs';
import { nativeGeometryCases } from './fixtures/geometry-cases.mjs';
import { compareNativeGolden } from './fixtures/native-golden.mjs';
import { observeNativeCase } from './fixtures/native-differential.mjs';
const golden = JSON.parse(
  await readFile(new URL('./fixtures/geometry-golden.json', import.meta.url)),
);
for (const [profile, record] of Object.entries(golden.profiles)) {
  test(`${profile} main matrix/vector golden GCALL without an EXE`, async () => {
    for (const input of nativeGeometryCases(profile))
      compareNativeGolden(
        await observeNativeCase(input),
        record.cases[input.name],
        input.policy,
        input.name,
      );
  });
  test(`${profile} current matrix belongs to the World and restores independently`, async () => {
    const bytes = kcsProgram([
        [37, 0xffffffff],
        [43, 0xcf, 4],
        [37, 0xffffffff],
        ...[3, 4, 5].map((n) => [37, floatBits(n)]),
        [43, 0xcd, 16],
        [37, 240],
        [43, 0x47, 4],
        [59],
      ]),
      game = memoryGame({ 'main.kcs': bytes });
    const make = () => {
      const random = new ParticleRandom(),
        world = new NativeWorld({
          profile,
          game,
          random,
          configuration: new NativeConfiguration({ profile }),
          images: {},
          host: {},
          motionLibrary: new MotionLibrary(game, { profile, random }),
          storage: { read: async () => null, write: async () => true },
        });
      world.ensureNativeEngine = () => {
        throw new Error('pure calculation attempted EXE load');
      };
      return world;
    };
    const original = make(),
      fresh = make();
    try {
      assert.deepEqual([...original.calculations.matrix], new Array(64).fill(0));
      await original.initialize('main.kcs');
      const saved = structuredClone(original.snapshot());
      assert.equal(saved.nativeEngine, null);
      await fresh.restore(saved);
      await fresh.runtime.native('main', 0x15e, [0xffffffff], fresh.main.machine, fresh.main);
      const read = (world) =>
        [12, 13, 14].map((i) =>
          bitsFloat(new DataView(world.calculations.matrix.buffer).getUint32(i * 4, true)),
        );
      assert.deepEqual(read(fresh), [-3, -4, -5]);
      assert.deepEqual(read(original), [3, 4, 5]);
    } finally {
      await fresh.close({ flushFiles: false });
      await original.close({ flushFiles: false });
    }
  });
}

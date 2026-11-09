// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { checkNativeEntry, nativeEntryGraph } from '../scripts/check-native-entry.mjs';
import { NativeWorld } from '../src/native/world.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { memoryGame, kcsProgram } from './helpers.mjs';

test('pure entry excludes the EXE loader and the transitional composition includes it explicitly', async () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  assert.ok((await checkNativeEntry(root)).includes('src/native/windows-services.mjs'));
  assert.ok(
    (await nativeEntryGraph(root, 'web/transitional-entry.mjs')).includes(
      'src/native/engine-process.mjs',
    ),
  );
});

test('a host-free World runs an authored JS script and reports unmigrated EXE operations', async () => {
  const profile = 'sdk-4.01-engine-2.6.1.74',
    game = memoryGame({ 'main.kcs': kcsProgram([[59]]) }),
    random = new ParticleRandom(),
    world = new NativeWorld({
      profile,
      game,
      random,
      images: {},
      host: {},
      configuration: new NativeConfiguration({ profile }),
      motionLibrary: new MotionLibrary(game, { profile, random }),
      storage: { read: async () => null, write: async () => true },
    });
  await world.initialize('main.kcs');
  assert.equal(world.main.status, 'finished');
  assert.throws(() => world.ensureNativeEngine(), /explicitly injected transitional EXE host/);
  let attempts = 0;
  world.transitionalExe = {
    open: async () => {
      attempts++;
      throw new Error('authored open failure');
    },
  };
  const first = world.ensureNativeEngine();
  assert.equal(first, world.ensureNativeEngine());
  await assert.rejects(first, /authored open failure/);
  assert.equal(world.nativeEngineLoading, null);
  await assert.rejects(world.ensureNativeEngine(), /authored open failure/);
  assert.equal(attempts, 2);
  await world.close({ flushFiles: false });
});

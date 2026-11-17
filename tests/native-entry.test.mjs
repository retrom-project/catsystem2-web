// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { checkNativeEntry, nativeEntryGraph } from '../scripts/check-native-entry.mjs';
import { NativeWorld } from '../src/native/world.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { memoryGame, kcsProgram } from './helpers.mjs';
import { installOriginalWorldRuntime } from '../oracle/native-world-runtime.mjs';
import { productionFiles, validateOrdinaryDistribution } from '../scripts/production-files.mjs';

test('pure entry excludes the EXE loader and the transitional composition includes it explicitly', async () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  assert.ok((await checkNativeEntry(root)).includes('src/native/emote-owner.mjs'));
  assert.ok(
    (await nativeEntryGraph(root, 'web/transitional-entry.mjs')).includes(
      'oracle/engine-process.mjs',
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
  assert.equal(typeof world.ensureNativeEngine, 'undefined');
  assert.equal(typeof world.getNativeFeature, 'undefined');
  assert.equal(Object.hasOwn(world.snapshot(), 'nativeEngine'), false);
  // Only this explicit test composition installs the original process API.
  installOriginalWorldRuntime(world);
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

test('actual ordinary build plan excludes original artifacts and keeps public text/decoder dependencies', async () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const plan = await productionFiles(root);
  assert.ok(plan.modules.includes('src/engine.mjs'));
  assert.ok(plan.modules.includes('src/ppi/x87.mjs'));
  assert.ok(plan.assets.includes('third_party/fonts/noto-sans-jp/NotoSansJP.ttf'));
  assert.ok(plan.files.includes('vendor/native_zlib.mjs'));
  assert.ok(plan.files.includes('vendor/native_freetype_248.mjs'));
  assert.ok(plan.files.includes('vendor/native_freetype.mjs'));
  for (const file of [
    'oracle/ppi-pe32.mjs',
    'web/transitional-entry.mjs',
    'vendor/unicorn_x86.js',
    'input/game.exe',
  ])
    assert.throws(() => validateOrdinaryDistribution([file]), /original execution/);
  assert.equal(
    plan.files.some((file) => file.startsWith('oracle/')),
    false,
  );
});

test('source graph classification retains Node/oracle facts while the actual product policy rejects them', async () => {
  const directory = await mkdtemp(new URL('../.local/stage10-graph-', import.meta.url));
  try {
    await writeFile(
      join(directory, 'fixture.mjs'),
      "import fs from 'node:fs'; export const input = process.env.CATSYSTEM2_TEST;\n",
    );
    const cache = new Map();
    assert.deepEqual(await nativeEntryGraph(directory, 'fixture.mjs', cache), ['fixture.mjs']);
    assert.equal(cache.get('fixture.mjs').privateFixtureReads, true);
    await assert.rejects(
      nativeEntryGraph(directory, 'fixture.mjs', new Map(), { strict: true }),
      /private fixture|external capability/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

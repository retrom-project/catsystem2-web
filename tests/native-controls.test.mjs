// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeWorld } from '../web/transitional-entry.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { ImageStore } from '../src/formats/hg3.mjs';
import { NATIVE_UNWRITTEN_WORD } from '../src/native/engine-message.mjs';
import { memoryGame } from './helpers.mjs';
import { controlFiles, controlFES } from './fixtures/control-files.mjs';
import { exerciseControlFlow } from './fixtures/control-flow-fixture.mjs';

async function fixture(profile, exe, source = '') {
  const game = memoryGame(await controlFiles(exe, source));
  game.width = 128;
  game.height = 96;
  game.resolveCategory = (name, category) => {
    const base = name.replaceAll('\\', '/'),
      extensions = { image: 'hg2', fes: 'fes', kcs: 'kcs', mot: 'kcs' };
    const path = base.includes('.') ? base : `${base}.${extensions[category] || category}`;
    return game.has(path) ? path : null;
  };
  game.readCategory = async (name, category) => {
    const path = game.resolveCategory(name, category);
    return path === null ? null : game.read(path);
  };
  game.requireCategory = async (name, category) => {
    const value = await game.readCategory(name, category);
    if (value === null) throw new Error(`Missing ${category} ${name}`);
    return value;
  };
  const random = new ParticleRandom(),
    configuration = new NativeConfiguration({ profile }),
    images = new ImageStore(game);
  Object.assign(configuration.screen, {
    width: 128,
    height: 96,
    currentWidth: 128,
    currentHeight: 96,
    virtualWidth: 128,
    virtualHeight: 96,
  });
  const world = new NativeWorld({
    game,
    images,
    host: {},
    profile,
    configuration,
    random,
    motionLibrary: new MotionLibrary(game, { profile, random }),
    storage: {
      read: (name) => game.read(name),
      write: async () => true,
      remove: async () => true,
      stat: async () => null,
    },
  });
  return world;
}
async function start(world) {
  world.graphics.initializeTextures();
  world.root = await world.objects.create({ kind: 1, name: 'Authored Top', frameRate: 60 });
  await world.objects.create({ kind: 11, parent: world.root, name: 'Authored Input' });
  world.main = await world.spawnScript('main.kcs');
  await world.tick();
}
for (const [profile, variable] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
]) {
  test(
    `${profile} original controls keep Base messages, task identities and a fresh-process checkpoint`,
    { skip: !process.env[variable] },
    async () => {
      const exe = new Uint8Array(await readFile(process.env[variable])),
        first = await fixture(profile, exe);
      let second;
      try {
        await start(first);
        const ids = [];
        for (const kind of [40, 41, 42]) {
          const id = await first.objects.create({
              kind,
              parent: first.main.id,
              name: 'Authored control',
            }),
            task = first.objects.objects.get(id).implementation,
            p = first.nativeEngine.process;
          ids.push(id);
          assert.equal(p.load(task.pointer + 4), first.nativeTaskID(id));
          assert.equal(p.load(task.pointer + 72), 60);
          assert.equal(await first.sendEngine(id, first.main.id, 13), 0);
          assert.equal(
            await first.sendEngine(id, first.main.id, 24, 0, -123),
            NATIVE_UNWRITTEN_WORD,
          );
          assert.equal(await first.sendEngine(id, first.main.id, 23), -123 >>> 0);
          const context = {};
          assert.equal(
            await first.sendEngine(id, first.main.id, 999, 0, 0, context),
            NATIVE_UNWRITTEN_WORD,
          );
          assert.equal(context.nativeUnhandled, true);
        }
        second = await fixture(profile, exe);
        await second.restore(structuredClone(first.snapshot()));
        for (const id of ids) {
          const task = second.objects.objects.get(id).implementation,
            p = second.nativeEngine.process,
            pointer = task.pointer;
          assert.equal(await second.sendEngine(id, second.main.id, 23), -123 >>> 0);
          await second.objects.release(id);
          assert.equal(p.allocations.has(pointer), false);
          assert.equal((await second.getNativeFeature('task-memory')).worldID(pointer), undefined);
        }
      } finally {
        await second?.close();
        await first.close();
      }
    },
  );
}

test(
  'SDK original FES controls load image frames, draw and deliver value/focus notifications',
  { skip: !process.env.CATSYSTEM2_SDK_EXE },
  async () => {
    const exe = new Uint8Array(await readFile(process.env.CATSYSTEM2_SDK_EXE));
    await exerciseControlFlow(() => fixture('sdk-4.01-engine-2.6.1.74', exe, controlFES), assert);
  },
);

// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeWorld } from '../src/native/world.mjs';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { NativeGlobalStringsBridge } from '../src/native/global-strings-bridge.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { kcsProgram, memoryGame } from './helpers.mjs';
for (const [profile, variable] of [
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
])
  test(
    `${profile} application events use original envelopes and reach canonical Script queues after fresh World restore`,
    { skip: !process.env[variable] },
    async () => {
      const bytes = new Uint8Array(await readFile(process.env[variable])),
        make = async () => {
          const game = memoryGame({ 'main.kcs': kcsProgram([[37, 1024], [43, 0x47, 4], [59]]) }),
            random = new ParticleRandom(),
            configuration = new NativeConfiguration({ profile }),
            world = new NativeWorld({
              game,
              images: {},
              host: {},
              profile,
              configuration,
              random,
              storage: { read: async () => null, write: async () => true },
              motionLibrary: new MotionLibrary(game, { profile, random }),
            }),
            engine = await NativeEngineProcess.open({ profile, bytes, configuration });
          new NativeGlobalStringsBridge(engine, world.globalStrings);
          world.nativeEngine = engine;
          world.nativeEngineLoading = Promise.resolve(engine);
          world.ensureNativeEngine = async () => engine;
          return world;
        },
        world = await make();
      let fresh;
      try {
        await world.initialize('main.kcs');
        const feature = await world.getNativeFeature('window-events');
        await feature.send(21);
        assert.deepEqual(world.main.messages, [[0, 0xffff0013, 0, 0]]);
        if (profile.startsWith('nekopara')) {
          const m = world.main.machine;
          assert.deepEqual(await world.runtime.native('main', 0x41e, [], m, world.main), {
            control: 2,
          });
          assert.deepEqual(world.windowMessages, [{ message: 0x468, wParam: 0, lParam: 0 }]);
          await world.processWindowMessages();
          assert.equal(world.main.messages.length, 2);
          world.main.messages.pop();
          world.configuration.authorMode = 1;
          await world.window.command(40096);
          assert.equal(await world.window.broadcast(), 1);
        }
        fresh = await make();
        await fresh.restore(structuredClone(world.snapshot()));
        if (profile.startsWith('nekopara')) {
          assert.equal(await fresh.window.broadcast(), 1);
          await fresh.window.command(40096);
          assert.equal(await fresh.window.broadcast(), 0);
          assert.equal(await world.window.broadcast(), 1);
        }
        const after = await fresh.getNativeFeature('window-events');
        await after.send(20);
        assert.deepEqual(fresh.main.messages, [
          [0, 0xffff0013, 0, 0],
          [0, 0xffff0012, 0, 0],
        ]);
        await after.send(162, 0, 0, { taskType: 12 });
        assert.equal(fresh.objects.objects.get(fresh.main.id).scriptEnabled, 0);
        assert.equal(world.objects.objects.get(world.main.id).scriptEnabled, 1);
      } finally {
        await world.close({ flushFiles: false });
        await fresh?.close({ flushFiles: false });
      }
    },
  );

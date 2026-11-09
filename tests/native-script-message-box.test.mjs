// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MotionLibrary } from '../src/motion/library.mjs';
import { NATIVE_EXE_PROFILES } from '../src/native/catalog.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NativeGlobalStringsBridge } from '../src/native/global-strings-bridge.mjs';
import { NATIVE_SCRIPT_MESSAGE_BOX } from '../src/native/script-message-box.mjs';
import { NativeWorld } from '../web/transitional-entry.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { kcsProgram, memoryGame } from './helpers.mjs';

const id = 0x1bd;
const main = kcsProgram(
  [[37, 256], [43, id, 4], [37, 2048], [43, 0x47, 4], [59]],
  [
    [256, '%s[G1024]\r\n%d[G1100]'],
    [1024, '確認 <message>'],
  ],
);

for (const [profile, { handler }] of Object.entries(NATIVE_SCRIPT_MESSAGE_BOX)) {
  const executable =
    process.env[profile.startsWith('sdk-') ? 'CATSYSTEM2_SDK_EXE' : 'CATSYSTEM2_ENGINE_EXE'];
  test(
    `original MessageBox formats and waits for acknowledgement in ${profile}`,
    {
      skip: !executable,
      timeout: 15000,
    },
    async () => {
      const bytes = new Uint8Array(await readFile(executable));
      const make = async () => {
        const game = memoryGame({ 'main.kcs': main }),
          configuration = new NativeConfiguration({ profile }),
          random = new ParticleRandom(),
          opened = Promise.withResolvers(),
          acknowledged = Promise.withResolvers(),
          world = new NativeWorld({
            game,
            profile,
            configuration,
            random,
            images: {},
            host: {
              nativeWindowAction(action, owner) {
                opened.resolve({ action, owner });
                return acknowledged.promise;
              },
            },
            storage: { read: async () => null, write: async () => true },
            motionLibrary: new MotionLibrary(game, { profile, random }),
          }),
          engine = await NativeEngineProcess.open({ bytes, profile, configuration });
        new NativeGlobalStringsBridge(engine, world.globalStrings);
        world.nativeEngine = engine;
        world.nativeEngineLoading = Promise.resolve(engine);
        return { world, opened, acknowledged };
      };
      const first = await make(),
        { world } = first;
      let fresh;
      const pending = world.initialize('main.kcs');
      pending.catch(first.opened.reject);
      const expected = (n) => ({
        type: 'script-message-box',
        caption: 'system error',
        message: `確認 <message>\r\n${n}`,
      });
      try {
        const initial = await first.opened.promise;
        assert.equal(initial.owner, world);
        assert.deepEqual(initial.action, expected(0));
        assert.equal(
          world.nativeEngine.process.load(NATIVE_EXE_PROFILES[profile].tables.main.va + id * 4),
          handler,
        );
        assert.throws(() => world.snapshot(), /settled frame/);
        first.acknowledged.resolve(1);
        await pending;
        assert.equal(world.main.machine.waiting.kind, 'message');

        fresh = await make();
        await fresh.world.restore(structuredClone(world.snapshot()));
        const task = fresh.world.main,
          machine = task.machine;
        machine.store(1100, 17);
        const restored = fresh.world.runtime.native('main', id, [256], machine, task);
        restored.catch(fresh.opened.reject);
        assert.deepEqual((await fresh.opened.promise).action, expected(17));
        fresh.acknowledged.resolve(1);
        assert.deepEqual(await restored, { control: 2 });
      } finally {
        first.acknowledged.resolve(0);
        fresh?.acknowledged.resolve(0);
        await pending.catch(() => {});
        await fresh?.world.close();
        await world.close();
      }
    },
  );
}

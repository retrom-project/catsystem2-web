// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MotionLibrary } from '../src/motion/library.mjs';
import { NATIVE_EXE_PROFILES } from '../oracle/executable-catalog.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { NativeEngineProcess } from '../oracle/engine-process.mjs';
import { NativeGlobalStringsBridge } from '../oracle/global-strings-bridge.mjs';
import { NATIVE_SCRIPT_MESSAGE_BOX } from '../oracle/script-message-box-original.mjs';
import { NativeWorld } from '../web/transitional-entry.mjs';
import { NativeWorld as OrdinaryWorld } from '../src/native/world.mjs';
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

for (const profile of ['grisaia-jp-engine-2.6.1.23', ...Object.keys(NATIVE_SCRIPT_MESSAGE_BOX)]) {
  test(`ordinary Script MessageBox formats, waits and cold restores without original CPU in ${profile}`, async () => {
    const sentinel = 0x13579bdf,
      script = kcsProgram(
        [[37, sentinel], [37, 256], [43, id, 4], [37, 2048], [43, 0x47, 4], [59]],
        [
          [256, '%s[G1024]\r\n%d[G1100]'],
          [1024, '確認 <message>'],
        ],
      ),
      make = () => {
        const game = memoryGame({ 'main.kcs': script }),
          configuration = new NativeConfiguration({ profile }),
          random = new ParticleRandom(),
          opened = Promise.withResolvers(),
          acknowledged = Promise.withResolvers(),
          actions = [],
          world = new OrdinaryWorld({
            game,
            profile,
            configuration,
            random,
            images: {},
            host: {
              nativeWindowAction(action, owner) {
                actions.push({ action, owner });
                opened.resolve();
                return acknowledged.promise;
              },
            },
            storage: { read: async () => null, write: async () => true },
            motionLibrary: new MotionLibrary(game, { profile, random }),
          });
        let cpu = 0;
        world.ensureNativeEngine = () => {
          cpu++;
          throw new Error('ordinary MessageBox attempted original CPU');
        };
        return { world, opened, acknowledged, actions, cpu: () => cpu };
      },
      first = make(),
      fresh = make(),
      expected = (n) => ({
        type: 'script-message-box',
        caption: 'system error',
        message: `確認 <message>\r\n${n}`,
      });
    const pending = first.world.initialize('main.kcs');
    pending.catch(first.opened.reject);
    try {
      await first.opened.promise;
      assert.deepEqual(
        first.actions.map((x) => x.action),
        [expected(0)],
      );
      assert.equal(first.actions[0].owner, first.world);
      assert.throws(() => first.world.snapshot(), /settled frame/);
      first.acknowledged.resolve(1);
      await pending;
      assert.equal(first.world.main.machine.waiting.kind, 'message');
      assert.equal(first.world.main.machine.load(first.world.main.machine.sp - 4), sentinel);
      const dto = structuredClone(first.world.snapshot());
      let draws = 0;
      for (const generator of [fresh.world.random.integer, fresh.world.random.real]) {
        const next = generator.nextUint32;
        generator.nextUint32 = function (...args) {
          draws++;
          return next.apply(this, args);
        };
      }
      await fresh.world.restore(structuredClone(dto));
      assert.deepEqual(fresh.world.snapshot(), dto);
      assert.deepEqual(fresh.actions, []);
      assert.equal(draws, 0);
      const task = fresh.world.main,
        machine = task.machine;
      machine.store(1100, 17);
      const resumed = fresh.world.runtime.native('main', id, [256], machine, task);
      resumed.catch(fresh.opened.reject);
      await fresh.opened.promise;
      assert.deepEqual(
        fresh.actions.map((x) => x.action),
        [expected(17)],
      );
      fresh.acknowledged.resolve(1);
      assert.deepEqual(await resumed, { control: 2 });
      // The game's prior MBToWideChar(932,1) and SDK MessageBoxA boundary differ.
      machine.bytes(512, 2).set([0x82, 0]);
      assert.deepEqual(await fresh.world.runtime.native('main', id, [512], machine, task), {
        control: 2,
      });
      assert.equal(
        fresh.actions.at(-1).action.message,
        profile.startsWith('nekopara-') ? '\u30fb' : '\0',
      );
      fresh.world.host.nativeWindowAction = () => 2;
      await assert.rejects(
        fresh.world.runtime.native('main', id, [256], machine, task),
        /IDOK or failure/,
      );
      const failure = new Error('ordinary dialog service failure');
      fresh.world.host.nativeWindowAction = () => Promise.reject(failure);
      await assert.rejects(
        fresh.world.runtime.native('main', id, [256], machine, task),
        (error) => error === failure,
      );
      delete fresh.world.host.nativeWindowAction;
      await assert.rejects(
        fresh.world.runtime.native('main', id, [256], machine, task),
        /requires its browser host service/,
      );
      assert.equal(first.cpu() + fresh.cpu(), 0);
      assert.equal(fresh.world.main.machine.load(fresh.world.main.machine.sp - 4), sentinel);
    } finally {
      first.acknowledged.resolve(0);
      fresh.acknowledged.resolve(0);
      await pending.catch(() => {});
      await first.world.close();
      await fresh.world.close();
    }
  });
}

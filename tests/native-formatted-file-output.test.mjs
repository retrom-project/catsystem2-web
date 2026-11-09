// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { NATIVE_PROFILES } from '../src/native/catalog.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NativeGlobalStringsBridge } from '../src/native/global-strings-bridge.mjs';
import { NATIVE_FORMATTED_FILE_OUTPUT } from '../src/native/storage.mjs';
import { NativeWorld } from '../web/transitional-entry.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { SaveSlotFiles } from './fixtures/save-slots-fixture.mjs';
import { kcsProgram, memoryGame } from './helpers.mjs';

const { id, handlers } = NATIVE_FORMATTED_FILE_OUTPUT;
const filename = '記録%d[G1100].txt';
const main = kcsProgram(
  [
    [37, 256],
    [37, 512],
    [43, id, 8],
    [37, 2048],
    [43, 0x47, 4],
    [37, 256],
    [37, 768],
    [43, id, 8],
    [37, 2048],
    [43, 0x47, 4],
    [59],
  ],
  [
    [256, filename],
    [512, '前 %s[G1024]'],
    [768, '後 %d[G1100]'],
    [1024, '一'],
    [1152, 'read-only.txt'],
  ],
);

for (const profile of Object.keys(handlers)) {
  const executable =
    process.env[profile.startsWith('sdk-') ? 'CATSYSTEM2_SDK_EXE' : 'CATSYSTEM2_ENGINE_EXE'];
  test(
    `0x237 writes original CP932 bytes at the original file cursor and restores in ${profile}`,
    {
      skip: !executable,
    },
    async () => {
      const files = new SaveSlotFiles(),
        bytes = new Uint8Array(await readFile(executable));
      const make = async () => {
        const game = memoryGame({ 'main.kcs': main }),
          configuration = new NativeConfiguration({ profile }),
          random = new ParticleRandom(),
          world = new NativeWorld({
            game,
            profile,
            configuration,
            random,
            images: {},
            host: {},
            storage: files,
            motionLibrary: new MotionLibrary(game, { profile, random }),
          }),
          engine = await NativeEngineProcess.open({
            bytes,
            profile,
            configuration,
            ...files.options(),
          });
        new NativeGlobalStringsBridge(engine, world.globalStrings);
        world.nativeEngine = engine;
        world.nativeEngineLoading = Promise.resolve(engine);
        return world;
      };
      const first = await make();
      let fresh;
      try {
        await first.initialize('main.kcs');
        assert.equal(
          first.nativeEngine.process.load(NATIVE_PROFILES[profile].tables.main.va + 4 * id),
          handlers[profile],
        );
        assert.deepEqual(await files.read(filename), encodeCP932('前 一\r\n'));
        assert.deepEqual(files.operations, [['write', filename.toLowerCase()]]);
        assert.equal(first.nativeEngine.kernel.files.size, 0);
        const saved = structuredClone(first.snapshot());
        fresh = await make();
        await fresh.restore(saved);
        fresh.main.machine.store(1100, 17);
        await fresh.runtime.scheduler.send(fresh.main.id, [0, 0, 0, 0]);
        assert.deepEqual(await files.read(filename), encodeCP932('前 一\r後 17\r\n'));
        assert.equal(fresh.nativeEngine.kernel.files.size, 0);

        await files.write('read-only.txt', Uint8Array.of(9, 8, 7));
        await files.setAttributes('read-only.txt', 1);
        const prior = files.operations.length;
        assert.deepEqual(
          await fresh.runtime.native('main', id, [1152, 768], fresh.main.machine, fresh.main),
          { control: 2 },
        );
        assert.deepEqual(await files.read('read-only.txt'), Uint8Array.of(9, 8, 7));
        assert.equal(files.operations.length, prior);
        assert.equal(fresh.nativeEngine.kernel.files.size, 0);
      } finally {
        await fresh?.close();
        await first.close();
      }
    },
  );
}

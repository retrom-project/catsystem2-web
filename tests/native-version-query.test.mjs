// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MotionLibrary } from '../src/motion/library.mjs';
import { NATIVE_PROFILES } from '../src/native/catalog.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NativeGlobalStringsBridge } from '../src/native/global-strings-bridge.mjs';
import { NATIVE_VERSION_QUERY } from '../src/native/version-query.mjs';
import { NativeWorld } from '../src/native/world.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { kcsProgram, memoryGame } from './helpers.mjs';

const { id, handlers } = NATIVE_VERSION_QUERY;
const program = kcsProgram([
  [37, 256],
  [37, 260],
  [37, 264],
  [37, 268],
  [43, id, 16],
  [37, 2048],
  [43, 0x47, 4],
  [59],
]);
for (const profile of Object.keys(handlers)) {
  const sdk = profile.startsWith('sdk-'),
    executable = process.env[sdk ? 'CATSYSTEM2_SDK_EXE' : 'CATSYSTEM2_ENGINE_EXE'];
  test(
    `original main 1BC uses the actual file version and live VM output in ${profile}`,
    {
      skip: !executable,
    },
    async () => {
      const bytes = new Uint8Array(await readFile(executable));
      const make = async () => {
        const game = memoryGame({ 'main.kcs': program }),
          configuration = new NativeConfiguration({ profile }),
          random = new ParticleRandom(),
          world = new NativeWorld({
            game,
            profile,
            configuration,
            random,
            images: {},
            host: {},
            storage: { read: async () => null, write: async () => true },
            motionLibrary: new MotionLibrary(game, { profile, random }),
          }),
          engine = await NativeEngineProcess.open({
            bytes,
            profile,
            configuration,
            name: '原エンジン.exe',
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
          first.nativeEngine.process.load(NATIVE_PROFILES[profile].tables.main.va + id * 4),
          handlers[profile],
        );
        const version = [2, 6, 1, sdk ? 74 : 76];
        assert.deepEqual(
          version.map((_, i) => first.main.machine.load(256 + i * 4)),
          version,
        );
        fresh = await make();
        await fresh.restore(structuredClone(first.snapshot()));
        const m = fresh.main.machine,
          out = m.allocate(16);
        await fresh.runtime.native('main', id, [out, out, out + 4, out], m, fresh.main);
        assert.equal(m.load(out), version[3], 'last aliased write wins');
        assert.equal(m.load(out + 4), version[2]);
        assert.deepEqual(
          version.map((_, i) => m.load(256 + i * 4)),
          version,
        );
      } finally {
        await fresh?.close();
        await first.close();
      }
    },
  );
}

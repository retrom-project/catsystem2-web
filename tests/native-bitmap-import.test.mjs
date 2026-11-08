// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeWorld } from '../src/native/world.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { encodeHG2 } from '../src/formats/hg2.mjs';
import { kcsProgram, memoryGame } from './helpers.mjs';

for (const [profile, variable] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
])
  test(
    `${profile} image-data decodes into a host bitmap and survives a fresh World checkpoint`,
    { skip: !process.env[variable] },
    async () => {
      const executable = new Uint8Array(await readFile(process.env[variable])),
        rgba = Uint8Array.from([
          1, 22, 43, 64, 85, 106, 127, 148, 169, 190, 211, 232, 253, 18, 39, 60,
        ]),
        image = await encodeHG2(
          { width: 2, height: 2, rgba },
          { crop: false, clearTransparent: false, baseX: 3, baseY: -4 },
        ),
        game = memoryGame({
          'main.kcs': kcsProgram([[37, 128], [43, 0x47, 4], [59]]),
          'probe.hg2': image,
        }),
        make = () => {
          const configuration = new NativeConfiguration({ profile }),
            random = new ParticleRandom();
          const world = new NativeWorld({
            game,
            images: {},
            host: {},
            profile,
            configuration,
            random,
            storage: { read: async () => null, write: async () => true },
            motionLibrary: new MotionLibrary(game, { profile, random }),
          });
          world.ensureNativeEngine = () => {
            if (!world.nativeEngineLoading)
              world.nativeEngineLoading = import('../src/native/engine-process.mjs').then(
                async ({ NativeEngineProcess }) => {
                  const engine = await NativeEngineProcess.open({
                    profile,
                    bytes: executable,
                    configuration,
                  });
                  world.nativeEngine = engine;
                  return engine;
                },
              );
            return world.nativeEngineLoading;
          };
          return world;
        },
        world = make();
      let restored;
      try {
        await world.initialize('main.kcs');
        const machine = world.main.machine;
        machine.writeString('probe.hg2', 128);
        const data = (await world.runtime.native('main', 0x16d, [128], machine, world.main)).value,
          pointer = (await world.getNativeFeature('data-buffers')).pointer(data),
          bitmap = (await world.runtime.native('main', 0x16c, [data, 0], machine, world.main))
            .value,
          decoded = world.graphics.images.get(bitmap);
        assert.deepEqual([...(await decoded.pixels())], [...rgba]);
        assert.deepEqual([decoded.state.baseX, decoded.state.baseY], [3, -4]);
        assert.equal(decoded.owner, world.main.id);
        assert.equal((await world.getNativeFeature('data-buffers')).words(pointer)[3], 1);
        const state = structuredClone(world.snapshot());
        restored = make();
        await restored.restore(state);
        assert.deepEqual([...(await restored.graphics.images.get(bitmap).pixels())], [...rgba]);
        assert.equal((await restored.getNativeFeature('data-buffers')).pointer(data), pointer);
        await restored.runtime.native('main', 0x16e, [data], restored.main.machine, restored.main);
        assert.deepEqual([...(await restored.graphics.images.get(bitmap).pixels())], [...rgba]);
        await world.runtime.native('main', 0x16e, [data], machine, world.main);
        assert.deepEqual([...(await decoded.pixels())], [...rgba]);
      } finally {
        await world.close({ flushFiles: false });
        await restored?.close({ flushFiles: false });
      }
    },
  );

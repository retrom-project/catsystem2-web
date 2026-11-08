// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeWorld } from '../src/native/world.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { floatBits } from '../src/kcs.mjs';
import { projectNativeTriangle } from '../src/render/native-geometry.mjs';
import { kcsProgram, memoryGame } from './helpers.mjs';

test(
  'SDK full view geometry shares its perspective word with live host projection and a fresh World',
  { skip: !process.env.CATSYSTEM2_SDK_EXE },
  async () => {
    const exe = new Uint8Array(await readFile(process.env.CATSYSTEM2_SDK_EXE)),
      profile = 'sdk-4.01-engine-2.6.1.74',
      make = () => {
        const game = memoryGame({
            'engine.exe': exe,
            'main.kcs': kcsProgram([[37, 128], [43, 0xd1, 4], [59]]),
          }),
          configuration = new NativeConfiguration({ profile }),
          random = new ParticleRandom();
        Object.assign(configuration.screen, {
          width: 640,
          height: 480,
          currentWidth: 640,
          currentHeight: 480,
          virtualWidth: 640,
          virtualHeight: 480,
        });
        return new NativeWorld({
          game,
          images: {},
          host: {},
          profile,
          configuration,
          random,
          motionLibrary: new MotionLibrary(game, { profile, random }),
          storage: { read: async () => null, write: async () => true },
        });
      },
      world = make();
    let fresh;
    try {
      await world.initialize('main.kcs');
      const task = world.main,
        m = task.machine,
        call = (id, args) => world.runtime.native('main', id, args, m, task),
        platform = await world.getNativeFeature('graphics-platform'),
        p = world.nativeEngine.process;
      m.bytes(256, 24).fill(0xa5);
      assert.deepEqual(await call(8, [256, 260]), { control: 2 });
      assert.deepEqual([m.load(256), m.load(260), m.load(264)], [640, 480, 0xa5a5a5a5]);
      await call(0x313, [256, 260, 264, 268]);
      assert.deepEqual(
        Array.from({ length: 5 }, (_, i) => m.load(256 + i * 4)),
        [0, 0, 640, 480, 0xa5a5a5a5],
      );
      assert.equal(world.graphics.cameraNear, 1000);
      await call(12, [floatBits(750)]);
      assert.equal(p.load(platform.refs.manager + 224), floatBits(750));
      assert.equal(world.graphics.projection().cameraNear, 750);
      const vertices = [
          { x: 10, y: 20, z: 500, color: 0xffffffff, u: 0, v: 0 },
          { x: 12, y: 20, z: 500, color: 0xffffffff, u: 1, v: 0 },
          { x: 10, y: 22, z: 500, color: 0xffffffff, u: 0, v: 1 },
        ],
        projected = projectNativeTriangle(vertices, {
          ...world.graphics.projection(),
          textured: true,
        });
      assert.deepEqual(
        projected.map((v) => [v.x, v.y]),
        [
          [30, 60],
          [36, 60],
          [30, 66],
        ],
      );
      fresh = make();
      await fresh.restore(structuredClone(world.snapshot()));
      assert.equal(fresh.graphics.cameraNear, 750);
      assert.deepEqual(
        projectNativeTriangle(vertices, { ...fresh.graphics.projection(), textured: true }),
        projected,
      );
      fresh.graphics.cameraNear = 500;
      assert.equal(fresh.nativeEngine.process.load(platform.refs.manager + 224), floatBits(500));
      assert.equal(world.graphics.cameraNear, 750);
      await fresh.runtime.native('main', 8, [128, 128], fresh.main.machine, fresh.main);
      assert.equal(
        fresh.main.machine.load(128),
        480,
        'the second output wins for an aliased destination',
      );
    } finally {
      await fresh?.close({ flushFiles: false });
      await world.close({ flushFiles: false });
    }
  },
);

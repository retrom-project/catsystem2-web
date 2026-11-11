// SPDX-License-Identifier: MPL-2.0
// Authored KX2 records exercise the two existing receiver loaders. Compare
// submitted geometry at one f32 ULP, preserving UVs and integer coverage.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { engineFixtureSet } from '../fixtures/oracle-fixtures.mjs';
import { createTextureMemoryWorld } from '../fixtures/texture-clear-fixture.mjs';
import { installGraphicsOracle } from '../fixtures/graphics-oracle-world.mjs';
import { ScreenVectorGPU } from '../fixtures/screen-effects-fixture.mjs';
import { NativeGraphicsPacket } from '../../src/native/graphics-task.mjs';
import { floatBits } from '../../src/kcs.mjs';
import { kcsProgram } from '../helpers.mjs';
const ordered = (n) => (n & 0x80000000 ? ~n >>> 0 : (n | 0x80000000) >>> 0);
const model = new NativeGraphicsPacket([
  0x0032584b,
  0,
  0,
  floatBits(8),
  floatBits(6),
  2,
  0,
  0,
  0,
  0xffffffff,
  floatBits(8),
  0,
  0,
  0xffffffff,
  0,
  floatBits(6),
  0,
  0xffffffff,
  floatBits(8),
  0,
  0,
  0xffffffff,
  floatBits(8),
  floatBits(6),
  0,
  0xffffffff,
  0,
  floatBits(6),
  0,
  0xffffffff,
])
  .bytes(0, 120)
  .slice();
for (const fixture of await engineFixtureSet())
  test(
    fixture.profile + ' JS file-backed Plane models match both original loaders',
    {
      skip:
        !fixture.available ||
        (!fixture.profile.startsWith('sdk-') && !process.env.CATSYSTEM2_EMOTE_DLL),
    },
    async () => {
      const files = new Map([
        ['engine.exe', fixture.bytes],
        ['mesh.kx2', model],
        ['main.kcs', kcsProgram([[37, 1024], [43, 0xd1, 4], [59]])],
      ]);
      if (!fixture.profile.startsWith('sdk-'))
        files.set(
          'emotedriver.dll',
          new Uint8Array(await readFile(process.env.CATSYSTEM2_EMOTE_DLL)),
        );
      const worlds = [
        installGraphicsOracle(createTextureMemoryWorld(fixture.profile, files)),
        createTextureMemoryWorld(fixture.profile, files),
      ];
      const send = (world, id, message, words = []) =>
        world.sendEngine(id, world.main.id, message, 0, 0, {
          payload: new NativeGraphicsPacket(words),
        });
      try {
        const ids = [];
        for (const world of worlds) {
          world.stageRenderer.gpu = new ScreenVectorGPU(16, 16);
          await world.initialize('main.kcs');
          ids.push(
            await world.objects.create({
              kind: 2,
              parent: world.root,
              nativeID: 0x300,
              name: 'File model',
            }),
          );
          await world.graphics.fill(0, 0, 8, 6, 0xff295cb4);
          world.main.machine.writeString('mesh.kx2', 128);
        }
        for (const message of [69, 70]) {
          const vectors = [];
          for (const [i, world] of worlds.entries()) {
            await world.sendEngine(ids[i], world.main.id, message, 0, 128);
            await send(world, ids[i], 49, [0, 0, 100].map(floatBits));
            await send(world, ids[i], 51, [2, 3, 0].map(floatBits));
            await world.sendEngine(ids[i], world.main.id, 48, 0, 1);
            const gpu = world.stageRenderer.gpu;
            gpu.draws = [];
            if (!i) {
              const platform = await world.getNativeFeature('graphics-platform'),
                p = world.nativeEngine.process,
                out = p.allocate(4, true),
                device = world.nativeEngine.features.get('renderer').d3d;
              try {
                platform.sync();
                await device.withStageTarget(
                  gpu.primaryTarget,
                  () => platform.graphRendering.draw([out, floatBits(0), floatBits(60000)]),
                  world.stageRenderer.screenDepth(),
                );
              } finally {
                p.free(out);
              }
            } else await world.screenEffects.rendering.drawRange(0, 60000);
            vectors.push(
              [...new Map(gpu.draws.flat().map((v) => [JSON.stringify(v), v])).values()].sort(
                (a, b) => a.x - b.x || a.y - b.y || a.u - b.u,
              ),
            );
          }
          assert.equal(vectors[1].length, vectors[0].length, 'vertex count ' + message);
          for (const [i, v] of vectors[0].entries()) {
            assert.equal(vectors[1][i].color, v.color);
            for (const field of ['x', 'y', 'z', 'w', 'u', 'v'])
              assert.ok(
                Math.abs(ordered(floatBits(vectors[1][i][field])) - ordered(floatBits(v[field]))) <=
                  1,
                `message ${message}, vertex ${i}.${field} ${vectors[1][i][field]}/${v[field]}`,
              );
          }
        }
      } finally {
        for (const world of worlds) await world.close({ flushFiles: false });
      }
    },
  );

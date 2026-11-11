// SPDX-License-Identifier: MPL-2.0
// Existing old receiver and D3D host expose the submitted vectors, without
// executable instrumentation. Normalize each uniform-color affine rectangle
// to its four corners, removing padded degenerate triangles and the choice
// of diagonal. Geometry must remain within one f32 ULP.
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
for (const fixture of await engineFixtureSet())
  test(
    fixture.profile + ' JS Plane trail geometry preserves the old finite D3D vectors',
    {
      skip:
        !fixture.available ||
        (!fixture.profile.startsWith('sdk-') && !process.env.CATSYSTEM2_EMOTE_DLL),
    },
    async (t) => {
      const files = new Map([
        ['engine.exe', fixture.bytes],
        ['main.kcs', kcsProgram([[37, 1024], [43, 0xd1, 4], [59]])],
      ]);
      if (!fixture.profile.startsWith('sdk-'))
        files.set(
          'emotedriver.dll',
          new Uint8Array(await readFile(process.env.CATSYSTEM2_EMOTE_DLL)),
        );
      for (const [mode, textured] of [
        ...[0, 1, 2, 3, 4, 5, 6].map((mode) => [mode, false]),
        [4, true],
        [5, true],
      ])
        await t.test('mode ' + mode + (textured ? ' textured' : ''), async () => {
          const worlds = [
              createTextureMemoryWorld(fixture.profile, files),
              createTextureMemoryWorld(fixture.profile, files),
            ],
            ids = [];
          installGraphicsOracle(worlds[0]);
          const send = (world, id, message, words = [], w = 0) =>
            world.sendEngine(id, world.main.id, message, w, 0, {
              payload: new NativeGraphicsPacket(words),
            });
          try {
            for (const world of worlds) {
              world.stageRenderer.gpu = new ScreenVectorGPU(16, 16);
              await world.initialize('main.kcs');
              const id = await world.objects.create({
                kind: 2,
                parent: world.root,
                nativeID: 0x300,
                name: 'Trail',
              });
              ids.push(id);
              if (textured) await world.graphics.fill(0, 0, 8, 8, 0xffc02040);
              await send(world, id, textured ? 41 : 42, [
                0,
                0,
                0,
                floatBits(6),
                floatBits(5),
                0,
                0,
                0xffc02040,
              ]);
              await send(world, id, 49, [0, 0, 300].map(floatBits));
              await send(world, id, 51, [8, 9, 0].map(floatBits));
              await world.sendEngine(id, world.main.id, 48, 0, 1);
              await send(
                world,
                id,
                79,
                [3, 1, 96, ...[1, 1, 1, 0, 2, 1, 0, 0].map(floatBits), mode, -10],
                1,
              );
              if (!mode) {
                const raw =
                    world === worlds[0]
                      ? world.nativeEngine.process.read(
                          world.nativeEngine.process.load(world.graphics.get(id).pointer + 320),
                          128,
                        )
                      : world.graphics.get(id).state.trail.history[0].slice(),
                  view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
                view.setFloat32(12, 14, true);
                await send(
                  world,
                  id,
                  80,
                  Array.from({ length: 32 }, (_, i) => view.getUint32(i * 4, true)),
                );
              }
            }
            let finalVectors;
            for (const position of [
              [12, 11, 0],
              [17, 14, 0],
              [22, 18, 0],
              [27, 20, 0],
            ]) {
              const values = [];
              for (const [i, world] of worlds.entries()) {
                await send(world, ids[i], 51, position.map(floatBits));
                await world.tick();
                const gpu = world.stageRenderer.gpu;
                gpu.draws = [];
                if (i === 0) {
                  const platform = await world.getNativeFeature('graphics-platform'),
                    p = world.nativeEngine.process,
                    output = p.allocate(4, true),
                    device = world.nativeEngine.features.get('renderer').d3d;
                  try {
                    platform.sync();
                    await device.withStageTarget(
                      gpu.primaryTarget,
                      () => platform.graphRendering.draw([output, floatBits(0), floatBits(60000)]),
                      world.stageRenderer.screenDepth(),
                    );
                  } finally {
                    p.free(output);
                  }
                } else await world.screenEffects.rendering.drawRange(0, 60000);
                values.push(
                  [
                    ...new Map(
                      gpu.draws.flat().map((vertex) => [JSON.stringify(vertex), vertex]),
                    ).values(),
                  ].sort((a, b) => a.z - b.z || a.x - b.x || a.y - b.y),
                );
              }
              finalVectors = values[1];
              assert.equal(values[1].length, values[0].length, 'vertex count at ' + position);
              for (let i = 0; i < values[0].length; i++) {
                assert.equal(values[1][i].color, values[0][i].color, 'color vertex ' + i);
                for (const field of ['x', 'y', 'z', 'w', 'u', 'v']) {
                  const actual = values[1][i][field],
                    expected = values[0][i][field];
                  assert.ok(
                    Number.isFinite(actual) && Number.isFinite(expected),
                    field + ' finite',
                  );
                  assert.ok(
                    Math.abs(ordered(floatBits(actual)) - ordered(floatBits(expected))) <= 1,
                    `position ${position}, vertex${i}.${field} ${actual}/${expected}`,
                  );
                }
              }
            }
            if (mode === 5 && !textured) {
              const fresh = createTextureMemoryWorld(fixture.profile, files);
              fresh.stageRenderer.gpu = new ScreenVectorGPU(16, 16);
              try {
                await fresh.restore(structuredClone(worlds[1].snapshot()));
                await fresh.screenEffects.rendering.drawRange(0, 60000);
                const restored = [
                  ...new Map(
                    fresh.stageRenderer.gpu.draws
                      .flat()
                      .map((vertex) => [JSON.stringify(vertex), vertex]),
                  ).values(),
                ].sort((a, b) => a.z - b.z || a.x - b.x || a.y - b.y);
                assert.deepEqual(restored, finalVectors, 'restored strip geometry');
              } finally {
                await fresh.close({ flushFiles: false });
              }
            }
          } finally {
            for (const world of worlds) await world.close({ flushFiles: false });
          }
        });
    },
  );

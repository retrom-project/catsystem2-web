// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { retainedRasterCases } from '../fixtures/retained-raster.mjs';
import { rasterizeRetainedBitmap, flipBitmapRows } from '../../src/native/raster-kernel.mjs';
import { floatBits } from '../../src/kcs.mjs';
import { NativeEngineProcess } from '../../src/native/engine-process.mjs';
import { NativeGraphicsPlatform } from '../../oracle/graphics-consumer-projection.mjs';
import { NativeGraphics } from '../../src/native/graphics.mjs';
import { NativeHandles } from '../../src/native/handles.mjs';
import { NativeConfiguration } from '../../src/native/config.mjs';
import { NativeDrawTask } from '../../src/native/draw-task.mjs';
import { NativeBitmap } from '../../src/native/image.mjs';
import { NativeRetainedDraw } from '../../oracle/retained-draw-original.mjs';
import { engineFixtureSet } from '../fixtures/oracle-fixtures.mjs';
const golden = JSON.parse(
  await readFile(new URL('../fixtures/native-retained-raster-golden.json', import.meta.url)),
);
// The existing oracle file verifies this same fixture against both frozen ABIs.
// All 43 operations are integer CPU math, including fixed-point affine sampling.
// Each CPU/VRAM byte is exact. No channel tolerance is used.
test('JS retained normal/MASK/BTYPE/affine matches both-ABI pixel goldens', () => {
  for (const [index, probe] of retainedRasterCases().entries()) {
    const pixels = new Uint8ClampedArray(8 * 7 * 4).fill(19),
      color = probe.clear;
    for (let y = probe.area[1]; y < probe.area[3]; y++)
      for (let x = probe.area[0]; x < probe.area[2]; x++)
        pixels.set(
          [(color >>> 16) & 255, (color >>> 8) & 255, color & 255, color >>> 24],
          (y * 8 + x) * 4,
        );
    rasterizeRetainedBitmap(pixels, 8, 7, probe.source.rgba, probe.source, probe.item, probe.area);
    assert.equal(
      Buffer.from(pixels).toString('base64'),
      golden.cases[index].vram,
      probe.name + ' VRAM',
    );
    assert.equal(
      Buffer.from(flipBitmapRows(pixels, 8, 7)).toString('base64'),
      golden.cases[index].cpu,
      probe.name + ' CPU',
    );
  }
});

for (const fixture of await engineFixtureSet())
  test(
    fixture.profile + ' format dispatch and nonfinite integer positions match retained oracle',
    { skip: fixture.available ? false : fixture.reason },
    async () => {
      const engine = await NativeEngineProcess.open(fixture),
        world = {
          profile: fixture.profile,
          nativeEngine: engine,
          game: { width: 8, height: 7 },
          runtime: { handles: new NativeHandles() },
          configuration: new NativeConfiguration({ profile: fixture.profile }),
          base: () => ({ message: () => 0 }),
          getNativeFeature: async (name) => engine.features.get(name),
        };
      world.graphics = new NativeGraphics(world);
      const platform = new NativeGraphicsPlatform(engine, world),
        retained = (world.retainedDraw = new NativeRetainedDraw(engine, world)),
        p = engine.process,
        probes = [
          { bpp: 3, alpha: 173 },
          { bpp: 3, mask: 4, alpha: 173 },
          { bpp: 3, blendType: 2, alpha: 173 },
          { bpp: 3, mode: 1, alpha: 173 },
          { bpp: 4, mask: 1, blendType: 2, alpha: 173 },
          { bpp: 4, mask: 4, mode: 1, alpha: 173 },
          { bpp: 4, alpha: 173, position: [Infinity, 1], base: [Infinity, 0] },
          { bpp: 4, alpha: 173, position: [NaN, 1], base: [NaN, 0] },
        ];
      try {
        for (const probe of probes) {
          const draw = new NativeDrawTask(world.graphics, { id: 2 }),
            bitmap = world.graphics.images.create(8, 7),
            input = new NativeBitmap(world.graphics.images, {
              width: 3,
              height: 2,
              bpp: 4,
              rgba: Uint8ClampedArray.from([
                23, 59, 181, 0, 19, 31, 211, 128, 127, 89, 41, 255, 61, 79, 101, 255, 47, 53, 197,
                65, 7, 17, 29, 0,
              ]),
            });
          draw.state.renderer = {
            bitmap,
            width: 8,
            height: 7,
            items: [],
            clearColor: 0x80563719,
            dirty: true,
            dirtyRects: [[0, 0, 8, 7]],
          };
          draw.state.offset = [0, 0];
          let state;
          await platform.withBitmap(input, async (pointer) => {
            if (probe.bpp === 3) {
              await retained.call(platform.abi.bitmapConfigure, [3, 2, 3], pointer, 2);
              const bytes = new Uint8Array(p.load(pointer + 20) * 2),
                pixels = flipBitmapRows(await input.pixels(), 3, 2);
              for (let y = 0; y < 2; y++)
                for (let x = 0; x < 3; x++) {
                  const at = (y * 3 + x) * 4;
                  bytes.set(
                    [pixels[at + 2], pixels[at + 1], pixels[at]],
                    y * p.load(pointer + 20) + x * 3,
                  );
                }
              p.write(p.load(pointer + 12), bytes);
            }
            p.store(pointer + 76, probe.mask ?? 0);
            p.store(pointer + 84, probe.blendType ?? 0);
            state = platform.logicalBitmap(pointer).state;
            state.bpp = probe.bpp;
            await retained.bind(draw, 1, [
              pointer,
              0,
              0,
              0,
              ...(probe.position ?? [2, 1]).map(floatBits),
              ...(probe.base ?? [0, 0]).map(floatBits),
              floatBits(0),
              floatBits(1),
              floatBits(1),
              probe.alpha,
              1,
              probe.mode ?? 0,
              0,
            ]);
          });
          const expected = new Uint8ClampedArray(8 * 7 * 4);
          for (let at = 0; at < expected.length; at += 4) expected.set([86, 55, 25, 128], at);
          const item = draw.entry(1);
          rasterizeRetainedBitmap(expected, 8, 7, state.rgba, state, item, [0, 0, 8, 7]);
          await draw.render(null, true);
          assert.deepEqual(
            flipBitmapRows(await world.graphics.images.get(bitmap).pixels(), 8, 7),
            expected,
            JSON.stringify(probe),
          );
          await draw.close();
        }
      } finally {
        await engine.close();
      }
    },
  );

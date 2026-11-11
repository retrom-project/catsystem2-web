// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NativeGraphicsPlatform } from '../oracle/graphics-consumer-projection.mjs';
import { NativeGraphics } from '../src/native/graphics.mjs';
import { NativeHandles } from '../src/native/handles.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { NativeDrawTask } from '../src/native/draw-task.mjs';
import { NativeBitmap } from '../src/native/image.mjs';
import { NativeRetainedDraw } from '../oracle/retained-draw-original.mjs';
import { retainedRasterCases, RETAINED_RASTER_SIZE } from './fixtures/retained-raster.mjs';
const golden = JSON.parse(
  await readFile(new URL('./fixtures/native-retained-raster-golden.json', import.meta.url)),
);
for (const [profile, variable, affineTable] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE', 0xb6f048],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE', 0xc73b68],
])
  test(
    `${profile} retained CPU MASK/BTYPE/affine and physical upload match original full-manager pixels`,
    { skip: !process.env[variable] },
    async () => {
      const [width, height] = RETAINED_RASTER_SIZE,
        engine = await NativeEngineProcess.open({
          profile,
          bytes: new Uint8Array(await readFile(process.env[variable])),
        }),
        world = {
          profile,
          nativeEngine: engine,
          game: { width, height },
          runtime: { handles: new NativeHandles() },
          configuration: new NativeConfiguration({ profile }),
          base: () => ({ message: () => 0 }),
        };
      world.graphics = new NativeGraphics(world);
      world.getNativeFeature = async (name) => {
        const feature = engine.features.get(name);
        if (!feature) throw new Error(`Missing authored feature ${name}`);
        return feature;
      };
      new NativeGraphicsPlatform(engine, world);
      new NativeRetainedDraw(engine, world);
      try {
        assert.equal(
          createHash('sha256')
            .update(engine.process.read(affineTable, 32769 * 4))
            .digest('hex'),
          golden.affineTableSha256,
          'Engine startup initializes the original affine table',
        );
        for (const [index, probe] of retainedRasterCases().entries()) {
          const draw = new NativeDrawTask(world.graphics, { id: 2 }),
            bitmap = world.graphics.images.create(width, height, 2),
            image = world.graphics.images.add(
              new NativeBitmap(world.graphics.images, probe.source),
            );
          draw.state.renderer = {
            bitmap,
            width,
            height,
            items: [],
            clearColor: probe.clear,
            dirty: true,
            dirtyRects: [probe.area],
          };
          draw.state.offset = [0, 0];
          (await world.graphics.images.get(bitmap).pixels()).fill(19);
          const item = await draw.upsert(probe.item.key, { ...probe.item, image });
          item.layer = probe.item.layer;
          item.clip = [...probe.item.clip];
          draw.state.renderer.dirtyRects = [probe.area];
          try {
            await draw.render(null, true);
            assert.equal(
              Buffer.from(await world.graphics.images.get(bitmap).pixels()).toString('base64'),
              golden.cases[index].cpu,
              `${probe.name}: CPU logical pixels`,
            );
            assert.equal(
              Buffer.from(
                await world.graphics.images.get(world.graphics.vramHandle).pixels(),
              ).toString('base64'),
              golden.cases[index].vram,
              `${probe.name}: physical texture rows`,
            );
            const retained = engine.features.get('retained-draw'),
              manager = retained.renderers.get(2),
              originalSource = manager.sources.get(item.key).pointer;
            draw.state.dirty = true;
            draw.state.renderer.dirtyRects = [probe.area];
            await draw.render(null, true);
            assert.equal(retained.renderers.get(2).pointer, manager.pointer);
            assert.equal(manager.sources.get(item.key).pointer, originalSource);
            assert.equal(
              Buffer.from(await world.graphics.images.get(bitmap).pixels()).toString('base64'),
              golden.cases[index].cpu,
              `${probe.name}: repeated draw retains the same manager and pixels`,
            );
            if (index === 20) {
              await world.graphics.images.get(image).fill(0, 0, 3, 4, 0xff204060);
              draw.state.dirty = true;
              draw.state.renderer.dirtyRects = [[0, 0, width, height]];
              await draw.render(null, true);
              assert.notEqual(manager.sources.get(item.key).pointer, originalSource);
              const changed = await world.graphics.images.get(bitmap).pixels();
              assert.ok(
                Array.from({ length: width * height }, (_, i) =>
                  changed.slice(i * 4, i * 4 + 4),
                ).some((pixel) => pixel.every((v, i) => v === [32, 64, 96, 255][i])),
              );
              const newSource = manager.sources.get(item.key).pointer;
              await draw.upsert(item.key, { ...item, image, position: [3, 0] });
              draw.state.dirty = true;
              draw.state.renderer.dirtyRects = [[0, 0, width, height]];
              await draw.render(null, true);
              assert.equal(manager.sources.get(item.key).pointer, newSource);
              await draw.remove(item.key);
              draw.state.dirty = true;
              draw.state.renderer.dirtyRects = [[0, 0, width, height]];
              await draw.render(null, true);
              assert.equal(manager.sources.size, 0);
            }
          } finally {
            await draw.close();
            assert.equal(engine.features.get('retained-draw').renderers.has(2), false);
            await world.graphics.images.release(image);
          }
        }
      } finally {
        await engine.close();
      }
    },
  );

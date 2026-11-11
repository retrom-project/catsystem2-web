// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { engineFixtureSet } from '../fixtures/oracle-fixtures.mjs';
import { createTextureMemoryWorld } from '../fixtures/texture-clear-fixture.mjs';
import { installGraphicsOracle } from '../fixtures/graphics-oracle-world.mjs';
import { ScreenVectorGPU } from '../fixtures/screen-effects-fixture.mjs';
import { kcsProgram } from '../helpers.mjs';
import { NativeTexturePages } from '../../src/native/texture-layout.mjs';
import { StageRenderer } from '../../src/render/stage.mjs';
for (const fixture of await engineFixtureSet())
  test(
    fixture.profile +
      ' JS VRAM pages preserve original dither, sparse clears and independent surfaces',
    {
      skip:
        !fixture.available ||
        (!fixture.profile.startsWith('sdk-') && !process.env.CATSYSTEM2_EMOTE_DLL),
    },
    async () => {
      const files = new Map([
        ['engine.exe', fixture.bytes],
        ['main.kcs', kcsProgram([[37, 1024], [43, 0xd1, 4], [59]])],
      ]);
      if (!fixture.profile.startsWith('sdk-'))
        files.set(
          'emotedriver.dll',
          new Uint8Array(await readFile(process.env.CATSYSTEM2_EMOTE_DLL)),
        );
      for (const initialDither of [0, 1]) {
        const world = installGraphicsOracle(createTextureMemoryWorld(fixture.profile, files)),
          stage = new StageRenderer();
        world.stageRenderer.gpu = new ScreenVectorGPU(16, 16);
        const config = world.configuration.fields.texture;
        config.size.set([8, 8]);
        config.grid.set([3, 2]);
        config.bppY.set([0, 1]);
        config.bpp = 32;
        config.dither = initialDither;
        config.areas.forEach((a) => a.fill(0xffffffff));
        config.areas[0].set([0, 0, 2, 2]);
        let candidate, fresh;
        try {
          await world.initialize('main.kcs');
          world.graphics.initializeTextures();
          const original = world.graphics.texturePages;
          candidate = new NativeTexturePages(
            { ...original.layout, dither: initialDither },
            { stage },
          );
          const handle = world.graphics.images.create(10, 10),
            bitmap = world.graphics.images.get(handle);
          bitmap.state.rgba = Uint8ClampedArray.from(
            { length: 400 },
            (_, i) => (i * 37 + 19) & 255,
          );
          await bitmap.changed();
          for (const dither of [0, 1]) {
            // The original view snapshots the dither preference during construction.
            // Later preference writes alone do not change its upload mode.
            config.dither = dither;
            await world.graphics.output(bitmap, [3, 2]);
            await candidate.upload(
              world.graphics.images.get(world.graphics.vramHandle),
              [3, 2, 13, 12],
            );
            for (const index of [0, 1, 3, 4])
              assert.deepEqual(
                [...candidate.frame(index).rgba],
                [...original.frame(index).rgba],
                'page ' + index + ' dither ' + dither,
              );
          }
          for (const page of candidate.pages.values())
            assert.equal(page.frame.rgba.buffer, stage.surfaces.get(page.surface).bytes.buffer);
          await world.graphics.fill(5, 4, 8, 7, 0);
          candidate.clear(5, 4, 8, 7);
          for (const index of [0, 1, 3, 4])
            assert.deepEqual(
              [...candidate.frame(index).rgba],
              [...original.frame(index).rgba],
              'clear page ' + index,
            );
          await original.releaseRectangle(0, 0, 1, 1);
          candidate.releaseRectangle(0, 0, 1, 1);
          assert.equal(candidate.pages.has(0), false);
          fresh = new NativeTexturePages(original.layout, { stage: new StageRenderer() });
          fresh.restore(structuredClone(candidate.snapshot()));
          assert.deepEqual(fresh.snapshot(), candidate.snapshot());
          candidate.close();
          assert.equal(stage.surfaces.records.size, 0);
          assert.ok(fresh.pages.size > 0);
        } finally {
          candidate?.close();
          fresh?.close();
          await world.close({ flushFiles: false });
        }
      }
    },
  );

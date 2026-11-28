// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeWorld } from '../web/transitional-entry.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { installGraphicsOracle } from './fixtures/graphics-oracle-world.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { NativeTexturePageView } from '../oracle/texture-memory-original.mjs';
import { memoryGame, kcsProgram } from './helpers.mjs';
import { exerciseTextureClear } from './fixtures/texture-clear-fixture.mjs';
import { exerciseTextureUpload } from './fixtures/texture-upload-fixture.mjs';

test(
  'SDK bounded uploads preserve original clipping, page dither and high-coordinate pixels across fresh World',
  { skip: !process.env.CATSYSTEM2_SDK_EXE },
  async () => {
    const checks = await exerciseTextureUpload(
      'sdk-4.01-engine-2.6.1.74',
      new Map([
        ['engine.exe', new Uint8Array(await readFile(process.env.CATSYSTEM2_SDK_EXE))],
        ['main.kcs', kcsProgram([[37, 1024], [43, 0xd1, 4], [43, 0x41, 0], [59]])],
      ]),
    );
    for (const [name, passed] of Object.entries(checks)) assert.equal(passed, true, name);
  },
);

test(
  'SDK large sparse VRAM clears use only original allocated pages and survive fresh World',
  { skip: !process.env.CATSYSTEM2_SDK_EXE },
  async () => {
    const checks = await exerciseTextureClear(
      'sdk-4.01-engine-2.6.1.74',
      new Map([
        ['engine.exe', new Uint8Array(await readFile(process.env.CATSYSTEM2_SDK_EXE))],
        ['main.kcs', kcsProgram([[37, 1024], [43, 0xd1, 4], [43, 0x41, 0], [59]])],
      ]),
    );
    for (const [name, passed] of Object.entries(checks)) assert.equal(passed, true, name);
  },
);

test(
  'SDK texture pages retain the original allocation, format and unique D3D backing across fresh World',
  { skip: !process.env.CATSYSTEM2_SDK_EXE },
  async () => {
    const profile = 'sdk-4.01-engine-2.6.1.74',
      game = memoryGame({
        'engine.exe': new Uint8Array(await readFile(process.env.CATSYSTEM2_SDK_EXE)),
        'main.kcs': kcsProgram([[37, 1024], [43, 0x41, 0], [59]]),
      });
    game.width = 24;
    game.height = 16;
    const make = () => {
        const configuration = new NativeConfiguration({ profile }),
          texture = configuration.fields.texture;
        Object.assign(configuration.screen, {
          width: 24,
          height: 16,
          currentWidth: 24,
          currentHeight: 16,
          virtualWidth: 24,
          virtualHeight: 16,
        });
        texture.size.set([8, 8]);
        texture.grid.set([3, 2]);
        texture.bppY.set([0, 1]);
        texture.bpp = 32;
        for (const area of texture.areas) area.fill(0xffffffff);
        texture.areas[0].set([0, 0, 2, 2]);
        return installGraphicsOracle(
          new NativeWorld({
            game,
            profile,
            configuration,
            images: {},
            host: {},
            random: new ParticleRandom(),
            motionLibrary: new MotionLibrary(game, { profile }),
            storage: { read: async () => null, write: async () => true },
          }),
        );
      },
      world = make();
    let fresh;
    try {
      await world.initialize('main.kcs');
      world.graphics.initializeTextures();
      const pages = world.graphics.texturePages,
        d3d = world.nativeEngine.features.get('renderer').d3d;
      assert.ok(pages instanceof NativeTexturePageView);
      assert.deepEqual([...pages.layout.size], [8, 8]);
      assert.deepEqual([...pages.layout.grid], [3, 2]);
      const upper = pages.texture(0),
        lower = pages.texture(3);
      assert.equal(d3d.objects.get(upper).format, 21);
      assert.equal(d3d.objects.get(lower).format, 26);
      assert.equal(pages.texture(2), 0);
      const handle = world.graphics.images.create(10, 10),
        bitmap = world.graphics.images.get(handle),
        rgba = Uint8ClampedArray.from({ length: 400 }, (_, i) =>
          i % 4 === 3 ? 255 : ((i >>> 2) * 29 + (i % 4) * 47 + 5) & 255,
        );
      bitmap.state.rgba = rgba;
      bitmap.changed();
      await world.graphics.output(bitmap, [3, 2]);
      const verify = (actual) => {
        for (let y = 0; y < 10; y++)
          for (let x = 0; x < 10; x++) {
            const dx = x + 3,
              dy = y + 2,
              index = Math.floor(dx / 8) + Math.floor(dy / 8) * 3,
              frame = actual.frame(index),
              offset = ((dy % 8) * 8 + (dx % 8)) * 4,
              phaseX = dx - Math.max(3, Math.floor(dx / 8) * 8),
              phaseY = dy - Math.max(2, Math.floor(dy / 8) * 8),
              // Original scalar dither table, indexed by interleaved x/y bits.
              threshold = [5, 13, 12, 4, 6, 14, 11, 3, 7, 15, 10, 2, 8, 16, 9, 1][
                ((((phaseX & 2) * 2) | (phaseX & 1) | (phaseY & 2)) * 2) | (phaseY & 1)
              ],
              expected = [...rgba.subarray((y * 10 + x) * 4, (y * 10 + x + 1) * 4)].map(
                (v, channel) =>
                  dy >= 8
                    ? Math.min(15, (v >>> 4) + (channel !== 3 && (v & 15) >= threshold ? 1 : 0)) *
                      17
                    : v,
              );
            assert.deepEqual([...frame.rgba.subarray(offset, offset + 4)], expected, `${dx},${dy}`);
          }
      };
      verify(pages);
      const saved = structuredClone(world.snapshot());
      assert.deepEqual(saved.graphics.texturePages, { native: true });
      fresh = make();
      await fresh.restore(saved);
      fresh.graphics.initializeTextures();
      verify(fresh.graphics.texturePages);
      assert.deepEqual([...fresh.graphics.texturePages.frame(0).rgba], [...pages.frame(0).rgba]);
      await pages.releaseRectangle(0, 0, 8, 8);
      assert.equal(pages.texture(0), 0);
      assert.equal(d3d.objects.has(upper), false);
      assert.equal(pages.texture(3), lower);
      await pages.allocateMissing();
      assert.ok(pages.texture(0));
      assert.ok(pages.frame(0).rgba.every((value) => value === 0));
      assert.equal(pages.texture(3), lower);
      assert.ok(fresh.graphics.texturePages.frame(0).rgba.some((value) => value !== 0));
    } finally {
      await fresh?.close({ flushFiles: false });
      await world.close({ flushFiles: false });
    }
  },
);

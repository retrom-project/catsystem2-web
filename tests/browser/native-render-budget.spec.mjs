// SPDX-License-Identifier: MPL-2.0
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { kcsProgram } from '../helpers.mjs';

// Full original retained manager calls with raster shortcuts disabled and
// a higher oracle budget. The counts include the post-upload continuation.
const cases = [
  {
    width: 1280,
    height: 720,
    mode: 4,
    affine: true,
    instructions: 379413960,
    bitmap: 'd3714ba6ac834373a913bd2e4698c7284cfca5207edfa4ad6e32aaa508bb7ed3',
    gpu: '5d252cda15aba4ba8710d697add76ce2fbf418e797a32b2c63d79b680929aec5',
  },
  {
    width: 1920,
    height: 1080,
    mode: 5,
    affine: true,
    instructions: 804811883,
    bitmap: 'efda336aebf7c98edac80ddbe0b4f3f642b7955b33519fe0d2bac10b073e64df',
    gpu: '01c69b48020d80885583f7cc0325e7c4cc23c5510c621becbbc9484f8d0534bd',
  },
  {
    width: 1920,
    height: 1080,
    mode: 4,
    affine: false,
    instructions: 288267216,
    bitmap: 'c3a7fb52004e8b2e84a7881555bb15f58a628fbefa0497bf7f4334498fe524ba',
    gpu: '0c0b53a2aa51004e8911baeb0f941faf8c00e9e347ca7a206e4b6523552a8900',
  },
  {
    width: 1920,
    height: 1080,
    mode: 5,
    affine: false,
    instructions: 246795216,
    bitmap: 'cc38733b455f1702283d68b1395e9692375c621d3a1fdbd6e98aa0ba797b674e',
    gpu: '0fa0383289458e0f3c59639580d8f17dbe27a984818315cd7f7c37e48ac25aec',
  },
];

for (const [profile, variable] of [
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
])
  for (const sample of cases)
    test(`${profile} ${sample.width}×${sample.height} ${sample.affine ? 'affine' : 'integer'} BTYPE ${sample.mode} stays within the native execution limit`, async ({
      page,
    }) => {
      const sdk = profile.startsWith('sdk-');
      test.skip(!process.env[variable] || (!sdk && !process.env.CATSYSTEM2_EMOTE_DLL));
      test.setTimeout(120000);
      const files = new Map([
        ['engine.exe', await readFile(process.env[variable])],
        ['main.kcs', kcsProgram([[37, 1024], [43, 0xd1, 4], [43, 0x41, 0], [59]])],
      ]);
      if (!sdk) files.set('emotedriver.dll', await readFile(process.env.CATSYSTEM2_EMOTE_DLL));
      await page.route('**/tests/fixtures/browser-native-world.mjs', (route) =>
        route.fulfill({
          path: new URL('../fixtures/browser-native-world.mjs', import.meta.url).pathname,
          contentType: 'text/javascript',
        }),
      );
      await page.route('**/render-budget-fixture/**', (route) => {
        const name = decodeURIComponent(
            new URL(route.request().url()).pathname.slice('/render-budget-fixture/'.length),
          ),
          body = files.get(name);
        return route.fulfill(body ? { body: Buffer.from(body) } : { status: 404, body: '' });
      });
      await page.goto('/');
      const result = await page.evaluate(
        async ({ profile, names, width, height, mode, affine }) => {
          const [{ browserNativeWorld, placeBrowserNativePlane }, { NativeBitmap }] =
              await Promise.all([
                import('/tests/fixtures/browser-native-world.mjs'),
                import('/src/native/image.mjs'),
              ]),
            files = new Map(
              await Promise.all(
                names.map(async (name) => [
                  name,
                  new Uint8Array(
                    await (
                      await fetch('/render-budget-fixture/' + encodeURIComponent(name))
                    ).arrayBuffer(),
                  ),
                ]),
              ),
            ),
            make = () =>
              browserNativeWorld({
                profile,
                files,
                width,
                height,
                storage: { read: async () => null, write: async () => true },
              }),
            render = (world) =>
              world.stageRenderer.render(world.graphics.stage, null, world.particles.drawItems()),
            digest = async (bytes) =>
              Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) =>
                byte.toString(16).padStart(2, '0'),
              ).join(''),
            world = make(),
            texture = world.configuration.fields.texture;
          texture.size.set([2048, 2048]);
          texture.grid.set([1, 1]);
          texture.bppY.set([1, 1]);
          texture.areas[0].set([0, 0, 1, 1]);
          let fresh;
          try {
            await world.initialize('main.kcs');
            const task = world.main,
              call = (id, args) => world.runtime.native('main', id, args, task.machine, task),
              id = await world.objects.create({
                kind: 15,
                parent: task.id,
                name: 'Full width Draw',
              }),
              nativeID = world.nativeTaskID(id),
              draw = world.graphics.drawTasks.get(id);
            await call(0x100, [nativeID, width, height]);
            await call(0x104, [nativeID, 0, 0]);
            const rgba = new Uint8ClampedArray(width * height * 4),
              clip = [0, 0, width, height],
              images = world.graphics.images,
              renderer = draw.state.renderer,
              alphas = [31, 127, 255];
            for (let y = 0; y < height; y++)
              for (let x = 0; x < width; x++) {
                const i = (y * width + x) * 4;
                rgba[i] = (x * 7 + y * 13) & 255;
                rgba[i + 1] = (x * 11 + y * 17) & 255;
                rgba[i + 2] = (x * 31 + y * 23) & 255;
                rgba[i + 3] = alphas[(x + y) % 3];
              }
            const image = images.add(
                new NativeBitmap(images, {
                  width,
                  height,
                  bpp: 4,
                  canvasWidth: width,
                  canvasHeight: height,
                  offsetX: 0,
                  offsetY: 0,
                  baseX: 0,
                  baseY: 0,
                  clip,
                  attributes: [],
                  source: null,
                  blendType: mode,
                  rgba,
                }),
              ),
              item = await draw.upsert(0x90001, {
                image,
                position: affine ? [4.25, 2.5] : [0, 0],
                base: [0, 0],
                scale: affine ? [0.99, 1.02] : [1, 1],
                rotation: affine ? 0.017 : 0,
                alpha: 255,
                visible: true,
                mode: Number(affine),
              });
            item.layer = 3;
            item.clip = clip;
            renderer.clearColor = 0x80ff807f;
            renderer.dirtyRects = [clip];
            await world.getNativeFeature('retained-draw');
            const p = world.nativeEngine.process,
              start = p.cpu.emu_start,
              segments = [];
            p.cpu.emu_start = function (...args) {
              try {
                return start.apply(this, args);
              } finally {
                if (p.rasterBudget) {
                  const { counter, limit } = p.instructionBudget();
                  segments.push({
                    counter: Number(counter),
                    limit: Number(limit),
                    credit: p.rasterBudget.credited,
                  });
                }
              }
            };
            try {
              await draw.render(null, true);
            } finally {
              p.cpu.emu_start = start;
            }
            const plane = await world.objects.create({
              kind: 2,
              parent: world.root,
              name: 'Draw texture',
            });
            await placeBrowserNativePlane(world, plane, {
              width,
              height,
              priority: 1000,
              position: [0, height, 0],
              scale: [1, -1, 1],
            });
            await render(world);
            const gpu = world.stageRenderer.gpu.pixels();
            fresh = make();
            await fresh.restore(structuredClone(world.snapshot()));
            const restored = fresh.graphics.drawTasks.get(id);
            restored.state.renderer.dirtyRects = [clip];
            await restored.render(null, true);
            await render(fresh);
            return {
              bitmap: await digest(await images.get(renderer.bitmap).pixels()),
              restoredBitmap: await digest(
                await fresh.graphics.images.get(restored.state.renderer.bitmap).pixels(),
              ),
              gpu: await digest(gpu),
              restoredGPU: await digest(fresh.stageRenderer.gpu.pixels()),
              segments,
            };
          } finally {
            await fresh?.close();
            await world.close();
          }
        },
        {
          profile,
          names: [...files.keys()],
          width: sample.width,
          height: sample.height,
          mode: sample.mode,
          affine: sample.affine,
        },
      );
      expect(result.bitmap).toBe(sample.bitmap);
      expect(result.restoredBitmap).toBe(sample.bitmap);
      expect(result.gpu).toBe(sample.gpu);
      expect(result.restoredGPU).toBe(sample.gpu);
      const credit = result.segments.at(-1)?.credit;
      expect(credit).toBeGreaterThan(200000000);
      expect(
        result.segments.every(({ counter, limit }) => counter <= limit && limit === 200000000),
      ).toBe(true);
      expect(result.segments.reduce((total, { counter }) => total + counter, credit)).toBe(
        sample.instructions,
      );
    });

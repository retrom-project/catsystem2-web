// SPDX-License-Identifier: MPL-2.0
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { kcsProgram } from '../helpers.mjs';

for (const [profile, variable] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
])
  test(`${profile} KCS 16F upload reaches the original tiled view and restores its GPU pixels`, async ({
    page,
  }) => {
    test.skip(
      !process.env[variable] || (!profile.startsWith('sdk-') && !process.env.CATSYSTEM2_EMOTE_DLL),
    );
    test.setTimeout(180000);
    const files = new Map([
      ['engine.exe', await readFile(process.env[variable])],
      ['main.kcs', kcsProgram([[37, 1024], [43, 0xd1, 4], [59]])],
    ]);
    if (!profile.startsWith('sdk-'))
      files.set('emotedriver.dll', await readFile(process.env.CATSYSTEM2_EMOTE_DLL));
    const helper = await readFile(new URL('../fixtures/browser-native-world.mjs', import.meta.url));
    await page.route('**/tests/fixtures/browser-native-world.mjs', (route) =>
      route.fulfill({ body: helper, contentType: 'text/javascript' }),
    );
    await page.route('**/bitmap-upload-fixture/**', (route) => {
      const name = decodeURIComponent(
          new URL(route.request().url()).pathname.slice('/bitmap-upload-fixture/'.length),
        ),
        bytes = files.get(name);
      return route.fulfill(bytes ? { body: Buffer.from(bytes) } : { status: 404, body: '' });
    });
    await page.goto('/');
    const result = await page.evaluate(
      async ({ profile, names }) => {
        const { browserNativeWorld, placeBrowserNativePlane } = await import(
            '/tests/fixtures/browser-native-world.mjs'
          ),
          files = new Map(
            await Promise.all(
              names.map(async (name) => [
                name,
                new Uint8Array(
                  await (
                    await fetch('/bitmap-upload-fixture/' + encodeURIComponent(name))
                  ).arrayBuffer(),
                ),
              ]),
            ),
          ),
          make = () => {
            const w = browserNativeWorld({
                profile,
                files,
                storage: { read: async () => null, write: async () => true },
              }),
              texture = w.configuration.fields.texture;
            texture.size.set([64, 64]);
            texture.grid.set([1, 1]);
            texture.bppY.set([0, 1]);
            texture.areas[0].set([0, 0, 1, 1]);
            texture.bpp = 32;
            return w;
          },
          world = make(),
          worlds = [world],
          render = (w) => w.stageRenderer.render(w.graphics.stage, null, w.particles.drawItems()),
          pixels = (w) =>
            new Uint8Array(w.stageRenderer.renderer.ctx.getImageData(0, 0, 64, 48).data),
          equal = (a, b, label) => {
            if (a.length !== b.length || a.some((v, i) => v !== b[i])) throw new Error(label);
          };
        try {
          await world.initialize('main.kcs');
          const planeID = await world.objects.create({
            kind: 2,
            parent: world.root,
            name: 'Native VRAM surface',
          });
          await placeBrowserNativePlane(world, planeID, { width: 64, height: 48, priority: 300 });
          await render(world);
          const before = pixels(world),
            task = world.main,
            m = task.machine,
            call = (id, args) => world.runtime.native('main', id, args, m, task),
            image = (await call(0x70, [4, 3])).value;
          await call(0x75, [image, 0, 0, 4, 3, 0xff123456]);
          await call(0x16f, [0, 5, 7, 4, 3, image, 0, 0, 4, 3]);
          await render(world);
          const after = pixels(world),
            changed = [];
          for (let y = 0; y < 48; y++)
            for (let x = 0; x < 64; x++) {
              const at = (y * 64 + x) * 4;
              if (after.slice(at, at + 4).some((v, i) => v !== before[at + i]))
                changed.push([x, y, ...after.slice(at, at + 4)]);
            }
          if (changed.length !== 12) {
            const vram = world.graphics.images.get(world.graphics.vramHandle),
              vp = await vram.pixels();
            throw new Error(
              'Original view upload changed ' +
                changed.length +
                ' pixels: ' +
                JSON.stringify({
                  changed: changed.slice(0, 15),
                  vram: [...vp.slice((7 * vram.width + 5) * 4, (7 * vram.width + 5) * 4 + 4)],
                  dimensions: [vram.width, vram.height],
                  planes: Object.keys(world.graphics.stage.planes),
                  shown: world.graphics.attachment(world.nativeTaskID(planeID))?.display,
                }),
            );
          }
          for (const pixel of changed)
            equal(pixel.slice(2), [0x12, 0x34, 0x56, 255], 'original uploaded color');
          const fresh = make();
          worlds.push(fresh);
          await fresh.restore(structuredClone(world.snapshot()));
          await render(fresh);
          equal(pixels(fresh), after, 'restored native VRAM GPU pixels');
          await fresh.runtime.native(
            'main',
            0x75,
            [image, 0, 0, 4, 3, 0xffaabbcc],
            fresh.main.machine,
            fresh.main,
          );
          await fresh.runtime.native(
            'main',
            0x16f,
            [0, 5, 7, 4, 3, image, 0, 0, 4, 3],
            fresh.main.machine,
            fresh.main,
          );
          await render(fresh);
          for (const [x, y] of changed)
            equal(
              [...pixels(fresh).slice((y * 64 + x) * 4, (y * 64 + x) * 4 + 4)],
              [0xaa, 0xbb, 0xcc, 255],
              'fresh replacement upload',
            );
          equal(pixels(world), after, 'independent original device');
          return { changed: changed.length };
        } finally {
          for (const w of worlds.reverse()) await w.close({ flushFiles: false });
        }
      },
      { profile, names: [...files.keys()] },
    );
    expect(result.changed).toBe(12);
  });

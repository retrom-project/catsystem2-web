// SPDX-License-Identifier: MPL-2.0
import { test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { renderSourceWorldFiles } from '../fixtures/render-sources-fixture.mjs';

for (const [profile, variable] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
])
  test(
    profile + ' original render-source records reach Draw and the restored browser view',
    async ({ page }) => {
      const sdk = profile.startsWith('sdk-');
      test.skip(!process.env[variable] || (!sdk && !process.env.CATSYSTEM2_EMOTE_DLL));
      test.setTimeout(180000);
      const { files, layout, rgba } = await renderSourceWorldFiles(
        profile,
        await readFile(process.env[variable]),
        sdk ? null : await readFile(process.env.CATSYSTEM2_EMOTE_DLL),
      );
      for (const name of ['browser-native-world.mjs', 'render-sources-world.mjs']) {
        const body = await readFile(new URL('../fixtures/' + name, import.meta.url));
        await page.route('**/tests/fixtures/' + name, (route) =>
          route.fulfill({ body, contentType: 'text/javascript' }),
        );
      }
      await page.route('**/render-sources-fixture/**', (route) => {
        const name = decodeURIComponent(
          new URL(route.request().url()).pathname.slice('/render-sources-fixture/'.length),
        );
        const bytes = files.get(name);
        return route.fulfill(bytes ? { body: Buffer.from(bytes) } : { status: 404, body: '' });
      });
      await page.goto('/');
      await page.evaluate(
        async ({ profile, names, layout, rgba }) => {
          const [{ browserNativeWorld, placeBrowserNativePlane }, { exerciseRenderSourcesWorld }] =
            await Promise.all([
              import('/tests/fixtures/browser-native-world.mjs'),
              import('/tests/fixtures/render-sources-world.mjs'),
            ]);
          const files = new Map(
            await Promise.all(
              names.map(async (name) => {
                const response = await fetch('/render-sources-fixture/' + encodeURIComponent(name));
                if (!response.ok) throw new Error('Missing authored render-source fixture ' + name);
                return [name, new Uint8Array(await response.arrayBuffer())];
              }),
            ),
          );
          const make = () => {
            const world = browserNativeWorld({
                profile,
                files,
                storage: { read: async () => null, write: async () => true },
              }),
              texture = world.configuration.fields.texture;
            world.game.nativeResources = { resolve: (name) => name };
            texture.size.set([64, 64]);
            texture.grid.set([1, 1]);
            texture.bppY.set([0, 1]);
            texture.areas[0].set([0, 0, 1, 1]);
            texture.bpp = 32;
            return world;
          };
          const assert = {
            equal(actual, expected, label) {
              if (!Object.is(actual, expected))
                throw new Error(label || 'Expected ' + expected + ', received ' + actual);
            },
            deepEqual(actual, expected, label) {
              if (JSON.stringify(actual) !== JSON.stringify(expected))
                throw new Error(label || 'Different native record or pixel bytes');
            },
            ok(value) {
              if (!value)
                throw new Error('The two Draw sources must have independent native references');
            },
          };
          let plane;
          const frame = async (world) => {
            if (!plane) {
              plane = await world.objects.create({ kind: 2, parent: world.root });
              await placeBrowserNativePlane(world, plane, { width: 64, height: 48, priority: 300 });
            }
            const renderer = world.stageRenderer;
            await renderer.render(world.graphics.stage, null, world.particles.drawItems());
            const pixels = renderer.renderer.ctx.getImageData(0, 0, 64, 48).data,
              colors = new Set();
            for (let at = 0; at < rgba.length; at += 4)
              colors.add(rgba.slice(at, at + 4).join(','));
            let matched = 0;
            for (let at = 0; at < pixels.length; at += 4)
              if (colors.has(pixels.subarray(at, at + 4).join(','))) matched++;
            assert.equal(matched, 12, 'all authored pixels from both source records reach the GPU');
            return pixels;
          };
          await exerciseRenderSourcesWorld(make, layout, rgba, assert, frame);
        },
        { profile, names: [...files.keys()], layout, rgba: [...rgba] },
      );
    },
  );

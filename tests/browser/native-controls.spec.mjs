// SPDX-License-Identifier: MPL-2.0
import { test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { controlFES, controlFiles } from '../fixtures/control-files.mjs';

for (const [profile, variable] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
])
  test(`${profile} mounted FES controls keep original dragging, notifications and checkpoints`, async ({
    page,
  }) => {
    const game = !profile.startsWith('sdk-');
    test.skip(!process.env[variable] || (game && !process.env.CATSYSTEM2_EMOTE_DLL));
    test.setTimeout(180000);
    const files = await controlFiles(await readFile(process.env[variable]), controlFES);
    if (game) files['emotedriver.dll'] = await readFile(process.env.CATSYSTEM2_EMOTE_DLL);
    await page.route('**/control-fixture/**', (route) => {
      const name = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop());
      return route.fulfill(files[name] ? { body: Buffer.from(files[name]) } : { status: 404 });
    });
    await page.route(
      /\/tests\/fixtures\/(browser-native-world|control-flow-fixture)\.mjs$/,
      (route) =>
        route.fulfill({
          path: new URL(
            '../fixtures/' + new URL(route.request().url()).pathname.split('/').pop(),
            import.meta.url,
          ).pathname,
          contentType: 'text/javascript',
        }),
    );
    await page.goto('/');
    await page.evaluate(
      async ({ profile, names }) => {
        const [{ browserNativeWorld, browserAssert }, { exerciseControlFlow }] = await Promise.all([
            import('/tests/fixtures/browser-native-world.mjs'),
            import('/tests/fixtures/control-flow-fixture.mjs'),
          ]),
          files = new Map(
            await Promise.all(
              names.map(async (name) => [
                name,
                new Uint8Array(await (await fetch('/control-fixture/' + name)).arrayBuffer()),
              ]),
            ),
          );
        await exerciseControlFlow(
          () =>
            browserNativeWorld({
              profile,
              files,
              width: 128,
              height: 96,
              storage: { read: async () => null, write: async () => true, stat: async () => null },
            }),
          browserAssert,
        );
      },
      { profile, names: Object.keys(files) },
    );
  });

// SPDX-License-Identifier: MPL-2.0
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { kcsProgram } from '../helpers.mjs';
import { nativeParticleFixture } from '../fixtures/ppi-native-fixture.mjs';

for (const [profile, variable] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
])
  test(`${profile} original model pixels retain shared-view alias and stable particle ties across fresh World`, async ({
    page,
  }) => {
    test.skip(
      !process.env[variable] || (!profile.startsWith('sdk-') && !process.env.CATSYSTEM2_EMOTE_DLL),
    );
    test.setTimeout(180000);
    const files = new Map([
      ['engine.exe', new Uint8Array(await readFile(process.env[variable]))],
      ['main.kcs', kcsProgram([[37, 1024], [43, 0xd1, 4], [43, 0x41, 0], [59]])],
      ['@cat/ptclpi/tie.ppi', nativeParticleFixture({ color: 0xff0000ff })],
    ]);
    if (!profile.startsWith('sdk-'))
      files.set(
        'emotedriver.dll',
        new Uint8Array(await readFile(process.env.CATSYSTEM2_EMOTE_DLL)),
      );
    await page.route('**/graph-render-fixture/**', async (route) => {
      const name = decodeURIComponent(
          new URL(route.request().url()).pathname.slice('/graph-render-fixture/'.length),
        ),
        bytes = files.get(name);
      await route.fulfill(bytes ? { body: Buffer.from(bytes) } : { status: 404, body: '' });
    });
    await page.route(
      /\/tests\/fixtures\/(graphics-render|texture-clear)-fixture\.mjs$/,
      async (route) => {
        const name = new URL(route.request().url()).pathname.split('/').pop();
        return route.fulfill({
          contentType: 'text/javascript',
          body: await readFile(new URL('../fixtures/' + name, import.meta.url)),
        });
      },
    );
    await page.goto('/');
    const result = await page.evaluate(
      async ({ profile, names }) => {
        const [{ exerciseGraphRendering }, { StageRenderer }] = await Promise.all([
            import('/tests/fixtures/graphics-render-fixture.mjs'),
            import('/src/render/stage.mjs'),
          ]),
          files = new Map(
            await Promise.all(
              names.map(async (name) => [
                name,
                new Uint8Array(
                  await (
                    await fetch('/graph-render-fixture/' + encodeURIComponent(name))
                  ).arrayBuffer(),
                ),
              ]),
            ),
          );
        return exerciseGraphRendering(profile, files, () => {
          const canvas = new OffscreenCanvas(16, 16);
          return new StageRenderer({
            canvas,
            ctx: canvas.getContext('2d'),
            begin() {
              this.ctx.reset();
            },
          });
        });
      },
      { profile, names: [...files.keys()] },
    );
    for (const [name, passed] of Object.entries(result)) expect(passed, name).toBe(true);
  });

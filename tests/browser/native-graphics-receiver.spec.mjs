// SPDX-License-Identifier: MPL-2.0
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { hg3, kcsProgram } from '../helpers.mjs';
import { nativeParticleFixture } from '../fixtures/ppi-native-fixture.mjs';
import { planeFES } from '../fixtures/plane-fes-fixture.mjs';

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
      ['planes.fes', new TextEncoder().encode(planeFES)],
      [
        'authored-scale.kcs',
        kcsProgram([
          [21, [0x13, 0x80000064], [0x13, 0x8000009c]],
          [21, [0x13, 0x80000068], [0x13, 0x800000a0]],
          [21, [0x13, 0x8000006c], [0x13, 0x800000a4]],
          [43, 0x26, 0],
          [59],
        ]),
      ],
      ['@cat/ptclpi/tie.ppi', nativeParticleFixture({ color: 0xff0000ff })],
      ['tie.hg3', hg3(16, 16, new Uint8Array(16 * 16 * 4).fill(255))],
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
      /\/tests\/fixtures\/(?:(graphics-render|texture-clear|plane-fes)-fixture|browser-native-world)\.mjs$/,
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
        const [
            { exerciseGraphRendering, exercisePlaneFileModel },
            { StageRenderer },
            { exercisePlaneFlow },
            { browserNativeWorld, browserAssert },
          ] = await Promise.all([
            import('/tests/fixtures/graphics-render-fixture.mjs'),
            import('/src/render/stage.mjs'),
            import('/tests/fixtures/plane-fes-fixture.mjs'),
            import('/tests/fixtures/browser-native-world.mjs'),
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
        const makeStage = () => {
          const canvas = new OffscreenCanvas(16, 16);
          return new StageRenderer({
            canvas,
            ctx: canvas.getContext('2d'),
            begin() {
              this.ctx.reset();
            },
          });
        };
        const result = await exerciseGraphRendering(profile, files, makeStage);
        result.fileModel = await exercisePlaneFileModel(profile, files, makeStage);
        await exercisePlaneFlow(() => {
          const world = browserNativeWorld({
            profile,
            files,
            storage: { read: async () => null, write: async () => true, stat: async () => null },
          });
          const texture = world.configuration.fields.texture;
          texture.grid.set([1, 1]);
          texture.areas[0].set([0, 0, 1, 1]);
          texture.bppY.set([1, 1]);
          return world;
        }, browserAssert);
        return result;
      },
      { profile, names: [...files.keys()] },
    );
    const { fileModel, ...checks } = result;
    for (const [name, passed] of Object.entries(checks)) expect(passed, name).toBe(true);
    expect(fileModel).toEqual({
      kind: 6,
      source: '@cat/kx2/mesh07.kx2',
      descriptor: true,
      loads: 2,
      colored: 48,
      unchanged: true,
      restored: true,
      control: 2,
    });
  });

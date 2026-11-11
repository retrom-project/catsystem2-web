// SPDX-License-Identifier: MPL-2.0
// Actual WebGL blending, depth and coverage require Chromium. Node tests compare
// vectors and integer working textures independently through the existing oracle.
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { kcsProgram } from '../helpers.mjs';
import { routeGraphicsOracle } from '../fixtures/oracle-browser-routes.mjs';
for (const [profile, variable] of [
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
])
  test(
    profile + ' JS screen-effect WebGL pixels match the original callbacks',
    async ({ page }) => {
      test.skip(
        !process.env[variable] ||
          (!profile.startsWith('sdk-') && !process.env.CATSYSTEM2_EMOTE_DLL),
      );
      test.setTimeout(180000);
      const files = new Map([
        ['engine.exe', new Uint8Array(await readFile(process.env[variable]))],
        ['main.kcs', kcsProgram([[37, 2048], [43, 0xd1, 4], [59]])],
      ]);
      if (!profile.startsWith('sdk-'))
        files.set(
          'emotedriver.dll',
          new Uint8Array(await readFile(process.env.CATSYSTEM2_EMOTE_DLL)),
        );
      await routeGraphicsOracle(page);
      for (const file of [
        'tests/fixtures/browser-native-world.mjs',
        'oracle/screen-effect-original.mjs',
        'oracle/screen-effect-render-original.mjs',
        'oracle/effect-commands-original.mjs',
      ]) {
        const body = await readFile(new URL('../../' + file, import.meta.url));
        await page.route('**/' + file, (route) =>
          route.fulfill({ body, contentType: 'text/javascript' }),
        );
      }
      await page.route('**/screen-differential/*', (route) => {
        const bytes = files.get(new URL(route.request().url()).pathname.split('/').at(-1));
        return route.fulfill(bytes ? { body: Buffer.from(bytes) } : { status: 404, body: '' });
      });
      await page.goto('/');
      const results = await page.evaluate(
        async ({ profile, names }) => {
          const [
            { browserNativeWorld, placeBrowserNativePlane },
            { NativeScreenEffects: OracleEffects },
            { NativeEffectCommands: OracleCommands },
            { NativeGraphicsPacket },
            { floatBits: bits },
            { identity },
          ] = await Promise.all([
            import('/tests/fixtures/browser-native-world.mjs'),
            import('/oracle/screen-effect-original.mjs'),
            import('/oracle/effect-commands-original.mjs'),
            import('/src/native/graphics-task.mjs'),
            import('/src/kcs.mjs'),
            import('/src/motion/matrix.mjs'),
          ]);
          const files = new Map(
              await Promise.all(
                names.map(async (name) => [
                  name,
                  new Uint8Array(await (await fetch('/screen-differential/' + name)).arrayBuffer()),
                ]),
              ),
            ),
            lo = bits(0),
            hi = bits(60000),
            results = [],
            cases = [
              [
                35,
                378,
                379,
                [...identity().map(bits), ...[-2, 3, 0].map(bits), 0x80ffffff, lo, hi],
              ],
              [36, 380, 381, [...[3, 4, 32, 24, 2, 3, 0, 60000].map(bits), 0x80ffffff]],
              [37, 382, 383, [3, lo, hi]],
              [38, 384, 385, [lo, hi, 8]],
              [39, 387, 388, [lo, hi, 8]],
              [50, 516, 518, [lo, hi, 8, 4, 0]],
              [51, 519, 520, [lo, hi, 8, 4, 1, 0]],
              [52, 521, 522, [lo, hi, 8, 32, 20, bits(1), bits(5)]],
              [57, 390, 391, [lo, hi, 8, bits(0.3), bits(8), bits(2)]],
              [58, 394, 395, [lo, hi, 8, 32, 20, bits(0.2), bits(16), bits(0.1), 0x80102030]],
            ];
          for (const [kind, initialize, start, params] of cases) {
            const worlds = [],
              ids = [],
              baseline = [];
            try {
              for (const original of [true, false]) {
                const world = browserNativeWorld({
                  profile,
                  files,
                  width: 65,
                  height: 49,
                  storage: { read: async () => null, write: async () => true },
                });
                worlds.push(world);
                if (original) {
                  const { installGraphicsOracle } = await import(
                    '/tests/fixtures/graphics-oracle-world.mjs'
                  );
                  installGraphicsOracle(world);
                  world.registerNativeFeature('screen-effects', (engine) =>
                    OracleEffects.open(engine, world),
                  );
                  world.objects.factories.set(kind, async (record, _objects, options) =>
                    (await world.getNativeFeature('screen-effects')).create(record, options),
                  );
                }
                await world.initialize('main.kcs');
                if (original) world.screenEffects = await world.getNativeFeature('screen-effects');
                const plane = await world.objects.create({
                  kind: 2,
                  parent: world.root,
                  name: 'Background',
                });
                await placeBrowserNativePlane(world, plane, {
                  width: 65,
                  height: 49,
                  color: 0xff406080,
                  priority: 300,
                });
                for (const [position, color, priority] of [
                  [[7, 6, 0], 0xffe06020, 30000],
                  [[4, 5, 0], 0xff20b040, 61000],
                ]) {
                  const patch = await world.objects.create({
                    kind: 2,
                    parent: world.root,
                    name: 'Patch',
                  });
                  await placeBrowserNativePlane(world, patch, {
                    width: 12,
                    height: 10,
                    color,
                    priority,
                    position,
                  });
                }
                await world.stageRenderer.render(world.graphics.stage, null, []);
                baseline.push(world.stageRenderer.gpu.pixels());
                const command = original && new OracleCommands(world.nativeEngine, world),
                  rendering = world.screenEffects.rendering;
                if (original) {
                  await command.apply(0x35a, [2], world.main.machine, world.main);
                  await command.apply(0x35b, [0, lo, hi], world.main.machine, world.main);
                  await command.apply(0x35b, [1, lo, hi], world.main.machine, world.main);
                } else {
                  rendering.prepare(2);
                  await rendering.capture(0, 0, 60000);
                  await rendering.capture(1, 0, 60000);
                }
                const id = await world.objects.create({
                  kind,
                  parent: world.root,
                  name: 'Authored FX',
                });
                ids.push(id);
                world.random.integer.seed(17);
                world.random.real.seed(17);
                if (kind === 39) {
                  const mask = world.graphics.images.create(4, 3, world.main.id),
                    image = world.graphics.images.get(mask),
                    pixels = await image.pixels();
                  for (let i = 0; i < 12; i++)
                    pixels.set([i * 11, i * 7, (i * 23) & 255, 255], i * 4);
                  await image.changed();
                  if (original)
                    await command.apply(
                      0x212,
                      [world.nativeTaskID(id), 8, lo, hi, mask],
                      world.main.machine,
                      world.main,
                    );
                  else
                    await world.sendEngine(id, world.root, initialize, 0, 0, {
                      payload: new NativeGraphicsPacket([...params, mask, 0]),
                    });
                  await world.graphics.images.release(mask);
                } else
                  await world.sendEngine(id, world.root, initialize, 0, 0, {
                    payload: new NativeGraphicsPacket(params),
                  });
                if (kind === 50) await world.sendEngine(id, world.root, 517);
                await world.sendEngine(id, world.root, start, 0, 1);
                await world.sendEngine(plane, world.main.id, 59, 1, 0xffa02040);
              }
              const rows = [];
              let baseMaximum = 0;
              for (let i = 0; i < baseline[0].length; i++)
                baseMaximum = Math.max(baseMaximum, Math.abs(baseline[0][i] - baseline[1][i]));
              if (baseMaximum > 1)
                throw new Error(
                  'Ordinary Plane baseline differs at kind ' + kind + ' by ' + baseMaximum,
                );

              for (let frame = 0; frame < 8; frame++) {
                const pixels = [];
                for (const world of worlds) {
                  await world.tick();
                  await world.stageRenderer.render(world.graphics.stage, null, []);
                  pixels.push(world.stageRenderer.gpu.pixels());
                }
                let maximum = 0,
                  different = 0,
                  first = -1;
                for (let i = 0; i < pixels[0].length; i++) {
                  const delta = Math.abs(pixels[0][i] - pixels[1][i]);
                  maximum = Math.max(maximum, delta);
                  if (delta > 1) {
                    different++;
                    if (first < 0) first = i;
                  }
                }
                const activity = await Promise.all(
                  worlds.map((world, i) => world.sendEngine(ids[i], world.root, 377)),
                );
                if (activity[0] !== activity[1])
                  throw new Error('Screen activity differs at kind ' + kind + ' frame ' + frame);
                rows.push({
                  frame,
                  maximum,
                  different,
                  first,
                  expected: first < 0 ? null : [...pixels[0].slice(first, first + 12)],
                  actual: first < 0 ? null : [...pixels[1].slice(first, first + 12)],
                  contexts:
                    first < 0
                      ? null
                      : worlds.map((world) => ({
                          depth: world.graphics.d3dContext.depthStencilEnabled,
                          last: [
                            world.graphics.d3dContext.lastDrawType,
                            world.graphics.d3dContext.lastBlend,
                          ],
                          samplers: [...world.graphics.d3dContext.samplers],
                        })),
                });
              }
              results.push({ kind, rows });
            } finally {
              for (const world of worlds.toReversed()) await world.close({ flushFiles: false });
            }
          }
          return results;
        },
        { profile, names: [...files.keys()] },
      );
      for (const result of results)
        for (const row of result.rows)
          expect(row.different, JSON.stringify({ kind: result.kind, ...row })).toBe(0);
    },
  );

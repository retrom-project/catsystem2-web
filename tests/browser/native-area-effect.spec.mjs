// SPDX-License-Identifier: MPL-2.0
// Chromium covers WebGL coverage, blending and restored device projections.
// Node differential tests cover packet bytes, working pixels, vertices and RNG.
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { kcsProgram } from '../helpers.mjs';
import { routeGraphicsOracle } from '../fixtures/oracle-browser-routes.mjs';
for (const [profile, variable] of [
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
])
  for (const targetKind of [26, 27, 28, 29, 30, 31, 18, 20, 19])
    test(
      profile + ' area kind ' + targetKind + ' matches original GPU pixels and fresh restore',
      async ({ page }) => {
        test.skip(
          !process.env[variable] ||
            (!profile.startsWith('sdk-') && !process.env.CATSYSTEM2_EMOTE_DLL),
        );
        test.setTimeout(240000);
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
          'tests/fixtures/area-effect-cases.mjs',
          'oracle/area-effect-original.mjs',
          'oracle/area-effect-commands-original.mjs',
          'oracle/area-effect-task.mjs',
        ]) {
          const body = await readFile(new URL('../../' + file, import.meta.url));
          await page.route('**/' + file, (route) =>
            route.fulfill({ body, contentType: 'text/javascript' }),
          );
        }
        await page.route('**/area-differential/*', (route) => {
          const bytes = files.get(new URL(route.request().url()).pathname.split('/').at(-1));
          return route.fulfill(bytes ? { body: Buffer.from(bytes) } : { status: 404, body: '' });
        });
        await page.goto('/');
        const results = await page.evaluate(
          async ({ profile, names, targetKind }) => {
            const [
              { browserNativeWorld, placeBrowserNativePlane },
              { NativeAreaEffects: OriginalArea },
              { NativeAreaEffectCommands: OriginalCommands },
              { authoredAreaBitmaps, areaPixelParameters },
              { floatBits: bits },
            ] = await Promise.all([
              import('/tests/fixtures/browser-native-world.mjs'),
              import('/oracle/area-effect-original.mjs'),
              import('/oracle/area-effect-commands-original.mjs'),
              import('/tests/fixtures/area-effect-cases.mjs'),
              import('/src/kcs.mjs'),
            ]);
            const files = new Map(
                await Promise.all(
                  names.map(async (name) => [
                    name,
                    new Uint8Array(await (await fetch('/area-differential/' + name)).arrayBuffer()),
                  ]),
                ),
              ),
              results = [];
            const make = () => {
              const world = browserNativeWorld({
                  profile,
                  files,
                  storage: { read: async () => null, write: async () => true },
                }),
                texture = world.configuration.fields.texture;
              texture.size.set([64, 64]);
              texture.grid.set([1, 1]);
              texture.bppY.set([0, 1]);
              texture.areas[0].set([0, 0, 1, 1]);
              texture.bpp = 32;
              return world;
            };
            const render = async (world) => {
              await world.stageRenderer.render(world.graphics.stage, null, []);
              return world.stageRenderer.gpu.pixels();
            };
            const compare = (a, b, label) => {
              let maximum = 0,
                count = 0,
                first = -1;
              for (let i = 0; i < a.length; i++) {
                const delta = Math.abs(a[i] - b[i]);
                maximum = Math.max(maximum, delta);
                if (delta > 1) {
                  count++;
                  if (first < 0) first = i;
                }
              }
              if (count)
                throw Error(
                  label +
                    ' RGBA ' +
                    JSON.stringify({
                      maximum,
                      count,
                      first,
                      expected: [...a.slice(first, first + 8)],
                      actual: [...b.slice(first, first + 8)],
                    }),
                );
              return maximum;
            };
            for (const kind of [targetKind]) {
              const worlds = [],
                ids = [],
                actors = [];
              let fresh;
              try {
                for (const original of [true, false]) {
                  const world = make();
                  worlds.push(world);
                  if (original) {
                    const { installGraphicsOracle } = await import(
                      '/tests/fixtures/graphics-oracle-world.mjs'
                    );
                    installGraphicsOracle(world);
                    world.registerNativeFeature('area-effects', (engine) =>
                      OriginalArea.open(engine, world),
                    );
                    for (let k = 17; k <= 31; k++)
                      world.objects.factories.set(k, async (record, _objects, options) =>
                        (await world.getNativeFeature('area-effects')).create(record, options),
                      );
                  }
                  await world.initialize('main.kcs');
                  const plane = await world.objects.create({
                    kind: 2,
                    parent: world.root,
                    name: 'Area scene',
                  });
                  await placeBrowserNativePlane(world, plane, {
                    width: kind < 26 ? 24 : 64,
                    height: kind < 26 ? 18 : 48,
                    priority: 300,
                  });
                  const uploadScene = async () => {
                    const handle = world.graphics.images.create(64, 48, world.main.id),
                      bitmap = world.graphics.images.get(handle),
                      rgba = await bitmap.pixels();
                    for (let y = 0; y < 48; y++)
                      for (let x = 0; x < 64; x++)
                        rgba.set(
                          [x * 3 + 32, y * 3 + 32, (x + y) % 2 ? 208 : 64, 255],
                          (y * 64 + x) * 4,
                        );
                    await bitmap.changed();
                    await world.graphics.output(bitmap, [0, 0]);
                  };
                  // Glass leaves pivot.w unwritten in its private shard allocation.
                  // Start before unrelated VRAM transfer scratch is allocated so
                  // the authored oracle has finite geometry. The earlier NaN
                  // heap-history evidence remains in the phase execution log.
                  if (kind !== 20) await uploadScene();
                  const id = await world.objects.create({
                    kind,
                    parent: world.root,
                    name: 'Authored area',
                  });
                  ids.push(id);
                  actors.push(world.objects.objects.get(id).implementation);
                  const handles = kind >= 26 ? await authoredAreaBitmaps(world) : [],
                    params =
                      kind >= 26
                        ? areaPixelParameters({ kind, duration: 8, blendDuration: 2 }, handles)
                        : kind === 18
                          ? [world.nativeTaskID(plane), 1, ...[4, 8, 30].map(bits)]
                          : kind === 20
                            ? [world.nativeTaskID(plane), bits(6), 8]
                            : [
                                ...[64, 16, 48].map(bits),
                                300,
                                ...[14, 7, 42].map(bits),
                                12,
                                12,
                                0xff60c4f4,
                              ];
                  params.forEach((n, i) => world.main.machine.store(128 + i * 4, n));
                  const commands = original
                      ? new OriginalCommands(world.nativeEngine, world)
                      : null,
                    call = (command, args) =>
                      commands
                        ? commands.apply(command, args, world.main.machine, world.main)
                        : world.runtime.native(
                            'main',
                            command,
                            args,
                            world.main.machine,
                            world.main,
                          );
                  world.random.integer.seed(17);
                  world.random.real.seed(17);
                  await call(0xc4, [world.nativeTaskID(id), 128]);
                  await call(0xc5, [world.nativeTaskID(id)]);
                  if (kind === 20) await uploadScene();
                }
                if (kind === 20) {
                  for (const current of worlds) {
                    const device = current.nativeEngine.features.get('renderer').d3d;
                    device.onDrawRaw = (raw) => {
                      const data = new DataView(
                        raw.bytes.buffer,
                        raw.bytes.byteOffset,
                        raw.bytes.byteLength,
                      );
                      current.areaDrawEvidence ??= [];
                      current.areaDrawEvidence.push({
                        type: raw.type,
                        stride: raw.stride,
                        count: raw.bytes.length / raw.stride,
                        first: Array.from({ length: Math.min(16, raw.bytes.length / 4) }, (_, i) =>
                          data.getFloat32(i * 4, true),
                        ),
                      });
                    };
                  }
                }
                const rows = [];
                for (let frame = 0; frame < 10; frame++) {
                  for (const world of worlds) await world.tick();
                  if (fresh) await fresh.tick();
                  const expected = await render(worlds[0]),
                    actual = await render(worlds[1]);
                  try {
                    rows.push(compare(expected, actual, 'kind ' + kind + ' frame ' + frame));
                  } catch (error) {
                    error.message +=
                      ' D3D ' + JSON.stringify(worlds.map((w) => w.areaDrawEvidence));
                    throw error;
                  }
                  if (fresh)
                    compare(actual, await render(fresh), 'fresh kind ' + kind + ' frame ' + frame);
                  const activity = await Promise.all(
                    worlds.map((world, i) => world.sendEngine(ids[i], world.root, 259)),
                  );
                  if (activity[0] !== activity[1])
                    throw Error('Area active flag differs for ' + kind + ' at ' + frame);
                  if (frame === 3) {
                    fresh = make();
                    await fresh.restore(structuredClone(worlds[1].snapshot()));
                    compare(actual, await render(fresh), 'immediate fresh ' + kind);
                  }
                }
                results.push({ kind, rows });
              } finally {
                await fresh?.close({ flushFiles: false });
                for (const world of worlds.toReversed()) await world.close({ flushFiles: false });
              }
            }
            return results;
          },
          { profile, names: [...files.keys()], targetKind },
        );
        expect(results.map((r) => r.kind)).toEqual([targetKind]);
      },
    );

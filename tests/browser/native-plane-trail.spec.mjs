import { routeGraphicsOracle } from '../fixtures/oracle-browser-routes.mjs';
// SPDX-License-Identifier: MPL-2.0
// Pixel coverage is exact. Normalized GPU alpha blending uses the phase6
// per-channel limit of one. Each fresh-World comparison remains byte-exact.
import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { kcsProgram } from '../helpers.mjs';

for (const [profile, variable] of [
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
])
  test(`${profile} KCS Plane trail retains its original history, graphs and pixels`, async ({
    page,
  }) => {
    const exe = process.env[variable],
      driver = process.env.CATSYSTEM2_EMOTE_DLL,
      sdk = profile.startsWith('sdk-');
    test.skip(!exe || (!sdk && !driver));
    test.setTimeout(120000);
    const files = new Map([
      ['engine.exe', await readFile(exe)],
      ...(!sdk ? [['emotedriver.dll', await readFile(driver)]] : []),
      ['main.kcs', kcsProgram([[37, 1024], [43, 0x47, 4], [59]])],
    ]);
    await page.route('**/tests/fixtures/browser-native-world.mjs', (route) =>
      route.fulfill({
        path: new URL('../fixtures/browser-native-world.mjs', import.meta.url).pathname,
        contentType: 'text/javascript',
      }),
    );
    await page.route('**/trail-fixture/*', (route) => {
      const bytes = files.get(new URL(route.request().url()).pathname.split('/').at(-1));
      return route.fulfill(bytes ? { body: Buffer.from(bytes) } : { status: 404, body: '' });
    });
    await routeGraphicsOracle(page);
    await page.goto('/');
    const result = await page.evaluate(
      async ({ profile, names }) => {
        const [
            { browserNativeWorld, placeBrowserNativePlane, browserAssert: assert },
            { NativeGraphicsPacket },
            { floatBits },
            { installGraphicsOracle },
          ] = await Promise.all([
            import('/tests/fixtures/browser-native-world.mjs'),
            import('/src/native/graphics-task.mjs'),
            import('/src/kcs.mjs'),
            import('/tests/fixtures/graphics-oracle-world.mjs'),
          ]),
          files = new Map(
            await Promise.all(
              names.map(async (name) => [
                name,
                new Uint8Array(await (await fetch('/trail-fixture/' + name)).arrayBuffer()),
              ]),
            ),
          ),
          run = async (oracle) => {
            const make = () => {
                const world = browserNativeWorld({
                  files,
                  profile,
                  storage: { read: async () => null, write: async () => true },
                });
                return oracle ? installGraphicsOracle(world) : world;
              },
              world = make();
            let fresh;
            try {
              await world.initialize('main.kcs');
              const id = await world.objects.create({ kind: 2, parent: world.main.id }),
                target = world.nativeTaskID(id),
                plane = world.graphics.get(id),
                p = oracle ? world.nativeEngine.process : null,
                call = (current, native, args) =>
                  current.runtime.native('main', native, args, current.main.machine, current.main),
                at = (current, x) =>
                  current.sendEngine(id, current.main.id, 51, 0, 0, {
                    payload: new NativeGraphicsPacket([x, 12, 0].map(floatBits)),
                  }),
                render = async (current) => {
                  const renderer = current.stageRenderer;
                  await renderer.render(current.graphics.stage);
                  const pixels = renderer.gpu.pixels();
                  let colored = 0;
                  for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 40) colored++;
                  return {
                    colored,
                    pixels: Array.from(pixels),
                    sha: new Uint8Array(await crypto.subtle.digest('SHA-256', pixels)).toHex(),
                  };
                };
              await placeBrowserNativePlane(world, id, {
                width: 6,
                height: 6,
                color: 0xffef2010,
                priority: 10000,
                position: [8, 12, 0],
              });
              const alone = await render(world);
              assert.ok(alone.colored > 0);
              assert.equal((await call(world, 0x18e, [0])).control, 2);
              const configure = [
                target,
                3,
                1,
                0,
                0,
                0,
                96,
                floatBits(1),
                floatBits(1),
                floatBits(1),
                0,
                -10,
              ];
              assert.equal((await call(world, 0x18e, configure)).control, 2);
              const history = () =>
                  oracle ? p.read(p.load(plane.pointer + 320), 128) : plane.state.trail.history[0],
                graphs = [1, 2, 3].map((i) => (target << 16) | i),
                graphExists = (owner, native) =>
                  oracle
                    ? owner.nativeEngine.features.get('graphics-platform').descriptor(native)
                    : owner.graphics.graphs.has(native);
              assert.ok(graphs.every((native) => graphExists(world, native)));
              assert.deepEqual(
                oracle
                  ? [264, 268, 272, 276, 312, 316].map((at) => p.load(plane.pointer + at))
                  : [
                      plane.state.trail.words[0],
                      plane.state.trail.length,
                      plane.state.trail.stride,
                      plane.state.trail.words[2],
                      plane.state.trail.mode,
                      plane.state.trail.words[12] >>> 0,
                    ],
                [3, 3, 1, 96, 0, -10 >>> 0],
              );

              const offsets = [256, 272, 288, 320],
                lengths = [12, 12, 12, 64],
                recordOffsets = [12, 28, 44, 60],
                vm = world.main.machine;
              offsets.forEach((address, i) =>
                vm
                  .bytes(address, lengths[i])
                  .set(history().subarray(recordOffsets[i], recordOffsets[i] + lengths[i])),
              );
              vm.store(offsets[0], floatBits(14));
              assert.equal(
                (
                  await call(world, 0x18f, [
                    target,
                    ...offsets,
                    new DataView(history().buffer, history().byteOffset).getUint32(124, true),
                    new DataView(history().buffer, history().byteOffset).getUint32(8, true),
                  ])
                ).control,
                2,
              );
              for (let i = 0; i < offsets.length; i++)
                assert.deepEqual(
                  history().subarray(recordOffsets[i], recordOffsets[i] + lengths[i]),
                  vm.bytes(offsets[i], lengths[i]),
                );
              for (const x of [18, 26, 34]) {
                await at(world, x);
                await world.tick();
              }
              const drawn = await render(world);
              assert.ok(drawn.colored > alone.colored, 'The trail should draw additional pixels');

              fresh = make();
              await fresh.restore(structuredClone(world.snapshot()));
              assert.deepEqual(await render(fresh), drawn);
              for (const current of [world, fresh]) {
                await at(current, 42);
                await current.tick();
              }
              assert.deepEqual(await render(fresh), await render(world));
              for (const current of [world, fresh]) {
                assert.equal(
                  (await call(current, 0x18e, [target, ...Array(11).fill(0)])).control,
                  2,
                );
                assert.equal(
                  oracle
                    ? current.nativeEngine.process.load(current.graphics.get(id).pointer + 320)
                    : Number(Boolean(current.graphics.get(id).state.trail)),
                  0,
                );
                assert.ok(graphs.every((id) => !graphExists(current, id)));
              }
              return { alone, drawn, cleared: await render(fresh) };
            } finally {
              await fresh?.close({ flushFiles: false });
              await world.close({ flushFiles: false });
            }
          };
        const original = await run(true),
          actual = await run(false);
        for (const phase of ['alone', 'drawn', 'cleared']) {
          assert.equal(actual[phase].colored, original[phase].colored);
          const differences = actual[phase].pixels.map((value, i) =>
              Math.abs(value - original[phase].pixels[i]),
            ),
            maximum = Math.max(...differences);
          assert.ok(
            maximum <= 1,
            phase +
              ' mixed-channel maximum difference ' +
              maximum +
              ' examples ' +
              JSON.stringify(
                differences
                  .flatMap((n, i) =>
                    n > 1 && i % 4 === 0
                      ? [
                          {
                            at: i / 4,
                            actual: actual[phase].pixels.slice(i, i + 4),
                            expected: original[phase].pixels.slice(i, i + 4),
                          },
                        ]
                      : [],
                  )
                  .slice(0, 8),
              ),
          );
          delete actual[phase].pixels;
        }
        return actual;
      },
      { profile, names: [...files.keys()] },
    );
    expect(result.drawn.colored).toBeGreaterThan(result.alone.colored);
    expect(result.cleared.colored).toBe(result.alone.colored);
  });

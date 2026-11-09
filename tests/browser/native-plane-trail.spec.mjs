// SPDX-License-Identifier: MPL-2.0
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
    await page.goto('/');
    const result = await page.evaluate(
      async ({ profile, names }) => {
        const [
            { browserNativeWorld, placeBrowserNativePlane, browserAssert: assert },
            { NativeGraphicsPacket },
            { floatBits },
          ] = await Promise.all([
            import('/tests/fixtures/browser-native-world.mjs'),
            import('/src/native/graphics-task.mjs'),
            import('/src/kcs.mjs'),
          ]),
          files = new Map(
            await Promise.all(
              names.map(async (name) => [
                name,
                new Uint8Array(await (await fetch('/trail-fixture/' + name)).arrayBuffer()),
              ]),
            ),
          ),
          make = () =>
            browserNativeWorld({
              files,
              profile,
              storage: { read: async () => null, write: async () => true },
            }),
          world = make();
        let fresh;
        try {
          await world.initialize('main.kcs');
          const id = await world.objects.create({ kind: 2, parent: world.main.id }),
            target = world.nativeTaskID(id),
            plane = world.graphics.get(id),
            p = world.nativeEngine.process,
            platform = await world.getNativeFeature('graphics-platform'),
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
          const history = p.load(plane.pointer + 320),
            graphs = [1, 2, 3].map((i) => (target << 16) | i);
          assert.ok(history && graphs.every((id) => platform.descriptor(id)));
          assert.deepEqual(
            [264, 268, 272, 276, 312, 316].map((at) => p.load(plane.pointer + at)),
            [3, 3, 1, 96, 0, -10 >>> 0],
          );

          const offsets = [256, 272, 288, 320],
            lengths = [12, 12, 12, 64],
            recordOffsets = [12, 28, 44, 60],
            vm = world.main.machine;
          offsets.forEach((address, i) =>
            vm.bytes(address, lengths[i]).set(p.read(history + recordOffsets[i], lengths[i])),
          );
          vm.store(offsets[0], floatBits(14));
          assert.equal(
            (
              await call(world, 0x18f, [
                target,
                ...offsets,
                p.load(history + 124),
                p.load(history + 8),
              ])
            ).control,
            2,
          );
          for (let i = 0; i < offsets.length; i++)
            assert.deepEqual(
              p.read(history + recordOffsets[i], lengths[i]),
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
            const renderer = await current.getNativeFeature('graphics-platform');
            assert.equal((await call(current, 0x18e, [target, ...Array(11).fill(0)])).control, 2);
            assert.equal(
              current.nativeEngine.process.load(current.graphics.get(id).pointer + 320),
              0,
            );
            assert.ok(graphs.every((id) => !renderer.descriptor(id)));
          }
          return { alone, drawn, cleared: await render(fresh) };
        } finally {
          await fresh?.close({ flushFiles: false });
          await world.close({ flushFiles: false });
        }
      },
      { profile, names: [...files.keys()] },
    );
    expect(result.drawn.colored).toBeGreaterThan(result.alone.colored);
    expect(result.cleared.colored).toBe(result.alone.colored);
  });

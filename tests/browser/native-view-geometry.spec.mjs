// SPDX-License-Identifier: MPL-2.0
import { test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { kcsProgram } from '../helpers.mjs';

for (const [profile, variable] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
]) {
  test(
    profile + ' original view positions keep live KCS aliases across restore',
    async ({ page }) => {
      const sdk = profile.startsWith('sdk-');
      test.skip(!process.env[variable] || (!sdk && !process.env.CATSYSTEM2_EMOTE_DLL));
      test.setTimeout(180000);
      const wait = [[37, 1800], [43, 0x47, 4], [59]],
        files = new Map([
          ['engine.exe', await readFile(process.env[variable])],
          ['main.kcs', kcsProgram(wait)],
          [
            'positions.kcs',
            kcsProgram([
              [37, 0],
              [37, 4],
              [43, 0x2e3, 8],
              [37, 128],
              [37, 128],
              [43, 0x2e3, 8],
              [37, 256],
              [37, 0x80000020],
              [43, 0x2e4, 8],
              ...wait,
            ]),
          ],
        ]);
      if (!sdk) files.set('emotedriver.dll', await readFile(process.env.CATSYSTEM2_EMOTE_DLL));
      const helper = await readFile(
        new URL('../fixtures/browser-native-world.mjs', import.meta.url),
      );
      await page.route('**/tests/fixtures/browser-native-world.mjs', (route) =>
        route.fulfill({ body: helper, contentType: 'text/javascript' }),
      );
      await page.route('**/view-geometry-fixture/*', (route) => {
        const body = files.get(new URL(route.request().url()).pathname.split('/').at(-1));
        return route.fulfill(body ? { body: Buffer.from(body) } : { status: 404, body: '' });
      });
      await page.goto('/');
      await page.evaluate(
        async ({ profile, names }) => {
          const { browserNativeWorld, browserAssert: assert } = await import(
              '/tests/fixtures/browser-native-world.mjs'
            ),
            { floatBits } = await import('/src/kcs.mjs'),
            { NATIVE_EXE_PROFILES } = await import('/src/native/catalog.mjs'),
            files = new Map(
              await Promise.all(
                names.map(async (name) => {
                  const response = await fetch('/view-geometry-fixture/' + name);
                  if (!response.ok) throw new Error('Missing view geometry fixture ' + name);
                  return [name, new Uint8Array(await response.arrayBuffer())];
                }),
              ),
            ),
            make = () =>
              browserNativeWorld({
                profile,
                files,
                storage: { read: async () => null, write: async () => true },
              }),
            world = make(),
            shared = 0x80000020,
            words = (m) => [0, 4, 128, 256, shared].map((address) => m.load(address) | 0),
            execute = async (owner, height) => {
              const task = await owner.spawnScript('positions.kcs', { parent: owner.main.id }),
                m = task.machine,
                { process: p } = owner.nativeEngine,
                { refs } = await owner.getNativeFeature('graphics-platform'),
                entries = [],
                detach = [0x2e3, 0x2e4].map((id) =>
                  p.beforeInstruction(
                    p.load(NATIVE_EXE_PROFILES[profile].tables.main.va + id * 4),
                    'original view position wrapper',
                    () => {
                      const esp = p.cpu.reg_read_i32(p.uc.X86_REG_ESP) >>> 0;
                      entries.push(id);
                      assert.equal(p.load(p.load(esp + 8) + 116), refs.view, 'live outer view');
                    },
                  ),
                );
              m.store(132, 0xa5a5a5a5);
              try {
                await owner.runtime.scheduler.execute(task);
              } finally {
                detach.forEach((remove) => remove());
              }
              assert.equal(m.waiting?.kind, 'message');
              assert.deepEqual(entries, [0x2e3, 0x2e3, 0x2e4]);
              assert.deepEqual(words(m), [2, -1, -2, -2, height]);
              assert.equal(m.load(132), 0xa5a5a5a5);
              assert.equal(p.load(p.addressOf(m.bytes(0, 4))), 2, 'VM zero is live guest RAM');
              return task;
            };
          let fresh;
          try {
            await world.initialize('main.kcs');
            const platform = await world.getNativeFeature('graphics-platform');
            await platform.ensureRenderer();
            const { view, manager } = platform.refs,
              p = world.nativeEngine.process;
            Object.assign(world.configuration.screen, {
              fullPosition: 0,
              fullHeight: 600,
              virtualHeight: 432,
            });
            p.store(manager + 228, floatBits(5.75));
            p.store(manager + 232, floatBits(-3.25));
            p.store(manager + 484, floatBits(2));
            p.store(manager + 512, 480);
            p.store(view + 68, floatBits(1));
            p.store(view + 72, floatBits(1));
            const original = await execute(world, 240);

            fresh = make();
            await fresh.restore(structuredClone(world.snapshot()));
            assert.deepEqual(
              words(fresh.runtime.scheduler.tasks.get(original.id).machine),
              [2, -1, -2, -2, 240],
            );
            assert.equal((await fresh.getNativeFeature('graphics-platform')).refs.view, view);
            fresh.configuration.screen.fullPosition = 1;
            const task = await execute(fresh, 301),
              m = task.machine,
              block = m.allocate(16),
              call = () => fresh.runtime.native('main', 0x2e4, [block, block + 4], m, task);
            m.bytes(block, 16).fill(0xa5);
            fresh.configuration.screen.fullPosition = 2;
            assert.deepEqual(await call(), { control: 2 });
            assert.deepEqual(
              [0, 4, 8, 12].map((at) => m.load(block + at)),
              [0, 432, 0xa5a5a5a5, 0xa5a5a5a5],
            );
            const restored = fresh.nativeEngine.process;
            assert.equal(restored.load(restored.addressOf(m.bytes(block + 4, 4))), 432);
            m.bytes(block, 16).fill(0x5a);
            fresh.configuration.screen.fullPosition = 0xffffffff;
            assert.deepEqual(await call(), { control: 2 });
            assert.deepEqual(
              [0, 4, 8, 12].map((at) => m.load(block + at)),
              [0, 0x5a5a5a5a, 0x5a5a5a5a, 0x5a5a5a5a],
            );
            assert.equal(world.configuration.screen.fullPosition, 0);
            assert.deepEqual(words(original.machine), [2, -1, -2, -2, 240]);
          } finally {
            await fresh?.close({ flushFiles: false });
            await world.close({ flushFiles: false });
          }
        },
        { profile, names: [...files.keys()] },
      );
    },
  );
}

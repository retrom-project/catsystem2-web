// SPDX-License-Identifier: MPL-2.0
import { test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { kcsProgram } from '../helpers.mjs';

for (const [profile, variable] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
]) {
  test(
    profile + ' KCS tiled plane reaches the original Draw child receiver and GPU',
    async ({ page }) => {
      const sdk = profile.startsWith('sdk-');
      test.skip(!process.env[variable] || (!sdk && !process.env.CATSYSTEM2_EMOTE_DLL));
      test.setTimeout(180000);
      const wait = [[37, 1800], [43, 0x47, 4], [59]],
        files = new Map([
          ['engine.exe', await readFile(process.env[variable])],
          ['main.kcs', kcsProgram(wait)],
          [
            'tile.kcs',
            kcsProgram([
              [37, [0x14, 256]],
              [37, 0x40800000],
              [37, 0x40400000],
              [37, 2],
              [37, 2],
              [43, 0x1b1, 20],
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
      await page.route('**/tile-plane-fixture/*', (route) => {
        const name = new URL(route.request().url()).pathname.split('/').at(-1),
          body = files.get(name);
        return route.fulfill(body ? { body: Buffer.from(body) } : { status: 404, body: '' });
      });
      await page.goto('/');
      await page.evaluate(
        async ({ profile, names }) => {
          const { browserNativeWorld, browserAssert: assert } = await import(
              '/tests/fixtures/browser-native-world.mjs'
            ),
            { floatBits, bitsFloat } = await import('/src/kcs.mjs'),
            { NativeGraphicsPacket } = await import('/src/native/graphics-task.mjs'),
            files = new Map(
              await Promise.all(
                names.map(async (name) => {
                  const response = await fetch('/tile-plane-fixture/' + name);
                  if (!response.ok) throw new Error('Missing tiled-plane fixture ' + name);
                  return [name, new Uint8Array(await response.arrayBuffer())];
                }),
              ),
            ),
            make = () => {
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
            },
            world = make(),
            frame = async (owner) => {
              const renderer = owner.stageRenderer;
              await renderer.render(owner.graphics.stage, null, owner.particles.drawItems());
              return renderer.renderer.ctx.getImageData(0, 0, 64, 48).data;
            },
            call = (id, args) =>
              world.runtime.native('main', id, args, world.main.machine, world.main),
            shape = [floatBits(4), floatBits(3)],
            stack = [32, 1, 0xffffffff],
            gridPacket = [0, 0, 0, ...shape, ...stack, 2, 2],
            source = new Uint8ClampedArray(4 * 3 * 4);
          for (let y = 0; y < 3; y++)
            for (let x = 0; x < 4; x++)
              source.set([11 + x * 47, 23 + y * 67, 37 + (x ^ y) * 31, 255], (y * 4 + x) * 4);
          let fresh;
          try {
            await world.initialize('main.kcs');
            const surfaceID = await world.objects.create({ kind: 15, parent: world.main.id }),
              surface = world.graphics.drawTasks.get(surfaceID),
              nativeSurface = world.nativeTaskID(surfaceID);
            await call(0x100, [nativeSurface, 64, 48]);
            await call(0x104, [nativeSurface, 0, 0]);
            const parentID = surface.state.basePlane,
              parent = world.graphics.get(parentID),
              parentNativeID = world.nativeTaskID(parentID),
              platform = await world.getNativeFeature('graphics-platform'),
              p = world.nativeEngine.process,
              words = (process, address, length) =>
                Array.from({ length }, (_, i) => process.load(address + i * 4)),
              checkTiles = async (owner, expectedIDs) => {
                const process = owner.nativeEngine.process,
                  nativePlatform = await owner.getNativeFeature('graphics-platform'),
                  task = owner.graphics.get(parentID),
                  children = owner.objects.children(task.record);
                assert.equal(task.graph, null, 'the parent uses the actual native receiver');
                assert.equal(process.load(task.pointer + 336), 9, 'tiled SimplePlane model type');
                assert.deepEqual(words(process, task.pointer + 372, 10), gridPacket);
                const descriptor = nativePlatform.descriptor(parentNativeID);
                assert.ok(
                  descriptor && process.load(descriptor + 8),
                  'original parent custom model',
                );
                assert.equal(children.length, 4);
                const vector = async (id, message) => {
                  const packet = new NativeGraphicsPacket();
                  await owner.sendEngine(id, owner.main.id, message, 0, 0, { payload: packet });
                  return [0, 4, 8].map((at) => bitsFloat(packet.load(at)));
                };
                const parentBase = await vector(parentID, 61),
                  parentPos = await vector(parentID, 62);
                const ids = [];
                for (const [i, record] of children.entries()) {
                  assert.equal(record.kind, 2);
                  const child = owner.graphics.get(record.id),
                    descriptor = nativePlatform.descriptor(record.nativeID),
                    x = (i % 2) * 4,
                    y = Math.floor(i / 2) * 3;
                  assert.equal(child.graph, null, 'the child uses the actual native receiver');
                  assert.equal(process.load(child.pointer + 12), task.pointer);
                  assert.ok(descriptor && process.load(descriptor + 16), 'original child texture');
                  assert.deepEqual(words(process, child.pointer + 176, 2), shape);
                  assert.equal(process.load(child.pointer + 336), 1);
                  assert.deepEqual(words(process, child.pointer + 340, 8), gridPacket.slice(0, 8));
                  assert.deepEqual(
                    words(process, child.pointer + 148, 3),
                    [x, y, 0].map(floatBits),
                  );
                  assert.deepEqual(await vector(record.id, 62), parentPos);
                  assert.deepEqual(await vector(record.id, 61), [
                    parentBase[0] - x,
                    parentBase[1] - y,
                    parentBase[2],
                  ]);
                  ids.push([record.id, record.nativeID, child.pointer, descriptor]);
                }
                if (expectedIDs)
                  assert.deepEqual(ids, expectedIDs, 'fresh task and graph identities');
                return ids;
              };
            assert.equal(p.load(parent.pointer + 336), 1);
            for (const target of [0, 0x7fffffff, nativeSurface]) {
              assert.deepEqual(await call(0x1b1, [target, ...shape, 2, 2]), { control: 2 });
              assert.equal(p.load(parent.pointer + 336), 1);
              assert.equal(world.objects.children(parent.record).length, 0);
            }
            const emptyID = await world.objects.create({ kind: 2, parent: world.main.id }),
              empty = world.graphics.get(emptyID);
            for (const count of [
              [0, 1],
              [2, 0],
              [-1, 1],
              [1, -1],
            ]) {
              await call(0x1b1, [empty.record.nativeID, ...shape, ...count.map((n) => n >>> 0)]);
              assert.equal(p.load(empty.pointer + 336), 9);
              assert.equal(world.objects.children(empty.record).length, 0);
            }
            await world.objects.release(emptyID);

            const bitmap = world.graphics.images.get(world.graphics.images.create(4, 3));
            (await bitmap.pixels()).set(source);
            await bitmap.changed();
            await world.graphics.output(bitmap, [0, 0]);
            const before = await frame(world);
            const script = await world.spawnScript('tile.kcs', { parent: world.main.id }),
              wrapper = profile.startsWith('sdk-') ? 0x512cc0 : 0x6405e0;
            script.machine.store(256, parentNativeID);
            const detach = p.beforeInstruction(
              wrapper,
              'authored tiled-plane stack contents',
              () => {
                const esp = p.cpu.reg_read_i32(p.uc.X86_REG_ESP) >>> 0;
                stack.forEach((value, i) => p.store(esp - 24 + i * 4, value));
              },
            );
            try {
              await world.runtime.scheduler.execute(script);
            } finally {
              detach();
            }
            assert.equal(script.machine.waiting?.kind, 'message');
            const tiles = await checkTiles(world);
            await world.sendEngine(parentID, world.main.id, 47, 0, 1);
            for (const [id] of tiles) await world.sendEngine(id, world.main.id, 48, 0, 1);
            const rendered = await frame(world),
              changed = [];
            for (let y = 0; y < 48; y++)
              for (let x = 0; x < 64; x++) {
                const at = (y * 64 + x) * 4,
                  pixel = rendered.slice(at, at + 4);
                if (pixel.every((v, i) => v === before[at + i])) continue;
                changed.push([x, y]);
                const expected = ((y % 3) * 4 + (x % 4)) * 4;
                assert.deepEqual(
                  pixel,
                  source.slice(expected, expected + 4),
                  'original tile pixel',
                );
              }
            assert.deepEqual(
              changed,
              Array.from({ length: 48 }, (_, i) => [i % 8, Math.floor(i / 8)]),
              'native tiles cover exactly an 8 by 6 grid',
            );
            fresh = make();
            await fresh.restore(structuredClone(world.snapshot()));
            await checkTiles(fresh, tiles);
            assert.deepEqual(await frame(fresh), rendered, 'fresh original GPU pixels');
            await world.objects.destroy(surfaceID);
            await world.objects.release(surfaceID);
            for (const [id, nativeID] of [[parentID, parentNativeID], ...tiles]) {
              assert.equal(world.objects.objects.has(id), false, 'Draw released each tile task');
              assert.equal(platform.descriptor(nativeID), 0, 'Draw released each original model');
            }
            assert.deepEqual(await frame(world), before, 'released tiles disappear');
            assert.deepEqual(await frame(fresh), rendered, 'the fresh scene remains independent');
            const freshEmptyID = await fresh.objects.create({ kind: 2, parent: fresh.main.id }),
              freshEmpty = fresh.graphics.get(freshEmptyID);
            assert.deepEqual(
              await fresh.runtime.native(
                'main',
                0x1b1,
                [freshEmpty.record.nativeID, ...shape, 0, 1],
                fresh.main.machine,
                fresh.main,
              ),
              { control: 2 },
            );
            assert.equal(fresh.nativeEngine.process.load(freshEmpty.pointer + 336), 9);
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

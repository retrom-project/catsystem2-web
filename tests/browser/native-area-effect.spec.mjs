// SPDX-License-Identifier: MPL-2.0
import { test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { encodeHG2 } from '../../src/formats/hg2.mjs';
import { kcsProgram } from '../helpers.mjs';

const wait = [
    [37, 1800],
    [43, 0x47, 4],
  ],
  target = [37, [0x14, 128]],
  start = [
    [37, 29],
    [37, [0x14, 96]],
    [37, 64],
    [43, 0x42, 12],
    [38, 128],
    target,
    [37, [0x14, 100]],
    [43, 0xc4, 8],
    target,
    [43, 0xc5, 4],
    target,
    [43, 0xc8, 4],
    [38, 132],
  ],
  waitingPC = start.reduce((offset, instruction) => offset + 1 + (instruction.length - 1) * 5, 0);

async function openAreaFixture(page, profile, variable, files) {
  files.set('engine.exe', await readFile(process.env[variable]));
  if (!profile.startsWith('sdk-'))
    files.set('emotedriver.dll', await readFile(process.env.CATSYSTEM2_EMOTE_DLL));
  const helper = await readFile(new URL('../fixtures/browser-native-world.mjs', import.meta.url));
  await page.route('**/tests/fixtures/browser-native-world.mjs', (route) =>
    route.fulfill({ body: helper, contentType: 'text/javascript' }),
  );
  await page.route('**/area-effect-fixture/*', (route) => {
    const body = files.get(new URL(route.request().url()).pathname.split('/').at(-1));
    return route.fulfill(body ? { body: Buffer.from(body) } : { status: 404, body: '' });
  });
  await page.goto('/');
  return [...files.keys()];
}

for (const [profile, variable] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
]) {
  test(
    profile + ' KCS Wipe2 draws original masked frames and finishes after restore',
    async ({ page }) => {
      const sdk = profile.startsWith('sdk-');
      test.skip(!process.env[variable] || (!sdk && !process.env.CATSYSTEM2_EMOTE_DLL));
      test.setTimeout(180000);
      const red = Uint8Array.from({ length: 8 * 6 * 4 }, (_, i) =>
          i % 4 === 0 || i % 4 === 3 ? 255 : 0,
        ),
        files = new Map([
          ['previous.hg2', await encodeHG2({ width: 8, height: 6, rgba: red }, { crop: false })],
          ['main.kcs', kcsProgram([...wait, [39, 0], [41, 0]])],
          [
            'wipe.kcs',
            kcsProgram(
              [
                ...start,
                ...wait,
                [39, waitingPC],
                target,
                [43, 0xcb, 4],
                target,
                [43, 0xc8, 4],
                [38, 136],
                [59],
              ],
              [[64, 'Authored Wipe2']],
            ),
          ],
        ]);
      const names = await openAreaFixture(page, profile, variable, files);
      await page.evaluate(
        async ({ profile, names }) => {
          const {
              browserNativeWorld,
              browserAssert: assert,
              placeBrowserNativePlane,
            } = await import('/tests/fixtures/browser-native-world.mjs'),
            files = new Map(
              await Promise.all(
                names.map(async (name) => {
                  const response = await fetch('/area-effect-fixture/' + name);
                  if (!response.ok) throw new Error('Missing area effect fixture ' + name);
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
            call = (owner, id, ...args) =>
              owner.runtime.native('main', id, args, owner.main.machine, owner.main),
            checkPixels = async (owner, redColumns) => {
              const renderer = owner.stageRenderer;
              await renderer.render(owner.graphics.stage, null, owner.particles.drawItems());
              const pixels = renderer.renderer.ctx.getImageData(4, 3, 8, 6).data,
                expected = new Uint8ClampedArray(pixels.length);
              for (let i = 0; i < 8 * 6; i++)
                expected.set(i % 8 < redColumns ? [255, 0, 0, 255] : [0, 0, 255, 255], i * 4);
              assert.deepEqual(pixels, expected, 'original masked VRAM reaches the GPU');
            };
          let fresh;
          try {
            await world.initialize('main.kcs');
            const plane = await world.objects.create({ kind: 2, parent: world.root, name: 'VRAM' });
            await placeBrowserNativePlane(world, plane, { width: 64, height: 48, priority: 300 });
            const p = world.nativeEngine.process,
              m = world.main.machine,
              records = 0x80000020,
              stride = profile.startsWith('sdk-') ? 72 : 136;
            m.writeString('previous.hg2', 256);
            m.bytes(records, stride).fill(0xa5);
            assert.deepEqual(await call(world, 0x2bf, 256, records, 1), { control: 1, value: 1 });
            assert.equal(m.load(records), 1);
            const previous = m.load(records + 4),
              next = (await call(world, 0x70, 8, 6)).value,
              mask = (await call(world, 0x70, 8, 6)).value,
              bitmaps = await world.getNativeFeature('bitmap-memory'),
              b = world.graphics.images.get(mask),
              rgba = await b.pixels(),
              ramp = [0, 32, 64, 96, 128, 160, 192, 255];
            for (let i = 0; i < 8 * 6; i++) rgba.set([71, 13, ramp[i % 8], 255], i * 4);
            await b.changed();
            await call(world, 0x75, next, 0, 0, 8, 6, 0xff0000ff);
            const script = await world.spawnScript('wipe.kcs', { parent: world.main.id }),
              packet = script.machine.allocate(64),
              input = [4, previous, 0, 0, next, 0, 0, mask, 4, 3, 0, 0, 0, 0];
            script.machine.store(96, world.nativeTaskID(world.main.id));
            script.machine.store(100, packet);
            script.machine.bytes(packet, 64).fill(0xa5);
            input.forEach((value, i) => script.machine.store(packet + i * 4, value));
            const before = script.machine.bytes(packet, 64).slice();
            await world.runtime.scheduler.execute(script);
            const nativeID = script.machine.load(128),
              id = world.resolveTaskID(nativeID, script.id),
              effect = world.objects.objects.get(id).implementation,
              pointer = effect.pointer,
              working = p.load(pointer + 164),
              maskWrapper = await bitmaps.wrapper(mask),
              nextWrapper = await bitmaps.wrapper(next);
            assert.equal(effect.record.kind, 29);
            assert.equal(p.load(pointer + 64), 29, 'original factory kind');
            assert.deepEqual(
              [112, 124, 136].map((offset) => p.load(pointer + offset)),
              [previous, nextWrapper, maskWrapper],
            );
            assert.ok(p.allocations.has(working), 'original wipe owns a work bitmap');
            assert.equal(script.machine.load(132), 1);
            assert.deepEqual(script.machine.bytes(packet, 64), before);
            await world.tick();
            await checkPixels(world, 6);
            await world.tick();
            await checkPixels(world, 4);

            fresh = make();
            await fresh.restore(structuredClone(world.snapshot()));
            const rp = fresh.nativeEngine.process,
              restored = fresh.runtime.scheduler.tasks.get(script.id),
              renderSources = await fresh.getNativeFeature('render-sources'),
              restoredCall = (command, ...args) =>
                fresh.runtime.native('main', command, args, restored.machine, restored);
            assert.equal(fresh.objects.objects.get(id).implementation.pointer, pointer);
            assert.ok(renderSources.bitmapWrapperIdentity(previous), 'borrowed wrapper persists');
            assert.equal(rp.load(pointer + 64), 29);
            await checkPixels(fresh, 4);
            await fresh.tick();
            await checkPixels(fresh, 2);
            assert.equal(
              (await fresh.runtime.scheduler.send(restored.id, [1, 2, 3, 4])).accepted,
              true,
            );
            assert.equal(restored.machine.load(136), 0);
            await checkPixels(fresh, 0);
            await checkPixels(world, 4);

            await restoredCall(0xc5, nativeID);
            await fresh.tick();
            await checkPixels(fresh, 6);
            await restoredCall(0xc6, nativeID);
            await checkPixels(fresh, 0);
            assert.deepEqual(await restoredCall(0xc8, nativeID), { control: 1, value: 0 });
            const taskMemory = await fresh.getNativeFeature('task-memory');
            assert.deepEqual(await restoredCall(0xc8, 0x7fffffff), {
              control: 1,
              value: await taskMemory.pointer(restored.id),
            });

            restored.machine.store(packet + 28, 0);
            await restoredCall(0xc4, nativeID, packet);
            assert.equal(rp.load(pointer + 168), 0);
            assert.equal(rp.load(pointer + 164), 0);
            assert.equal(rp.allocations.has(working), false);
            restored.machine.store(packet + 28, mask);
            await restoredCall(0xc4, nativeID, packet);
            const replacement = rp.load(pointer + 164);
            assert.ok(rp.allocations.has(replacement));
            await fresh.objects.release(id);
            assert.equal(rp.allocations.has(pointer), false);
            assert.equal(rp.allocations.has(replacement), false);
            for (const wrapper of [previous, nextWrapper, maskWrapper])
              assert.ok(
                rp.allocations.has(wrapper),
                'effect destruction preserves borrowed bitmaps',
              );
            await call(fresh, 0x2c0, records, 1);
            assert.equal(renderSources.bitmapWrapperIdentity(previous), undefined);
            assert.ok(p.allocations.has(previous), 'the original World owns a separate source');
          } finally {
            await fresh?.close({ flushFiles: false });
            await world.close({ flushFiles: false });
          }
        },
        { profile, names },
      );
    },
  );

  test(
    profile + ' KCS CA replaces active Wipe1 and Fade sources across restore',
    async ({ page }) => {
      const sdk = profile.startsWith('sdk-');
      test.skip(!process.env[variable] || (!sdk && !process.env.CATSYSTEM2_EMOTE_DLL));
      test.setTimeout(180000);
      const green = Uint8Array.from({ length: 8 * 6 * 4 }, (_, i) => (i % 2 ? 255 : 0)),
        replace = [...wait, [39, waitingPC], target, [37, [0x14, 104]], [43, 0xca, 8]],
        replacePC = waitingPC + replace.reduce((offset, op) => offset + 1 + (op.length - 1) * 5, 0),
        files = new Map([
          [
            'replacement.hg2',
            await encodeHG2({ width: 8, height: 6, rgba: green }, { crop: false }),
          ],
          ['main.kcs', kcsProgram([...wait, [39, 0], [41, 0]])],
          ...[26, 27].map((kind) => [
            kind + '.kcs',
            kcsProgram(
              [
                [37, kind],
                ...start.slice(1),
                ...replace,
                ...wait,
                [39, replacePC],
                target,
                [43, 0xc6, 4],
                [59],
              ],
              [[64, 'Authored replacement']],
            ),
          ]),
        ]),
        names = await openAreaFixture(page, profile, variable, files);
      await page.evaluate(
        async ({ profile, names, sdk }) => {
          const {
              browserNativeWorld,
              browserAssert: assert,
              placeBrowserNativePlane,
            } = await import('/tests/fixtures/browser-native-world.mjs'),
            files = new Map(
              await Promise.all(
                names.map(async (name) => {
                  const response = await fetch('/area-effect-fixture/' + name);
                  if (!response.ok) throw new Error('Missing area effect fixture ' + name);
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
            call = (owner, id, ...args) =>
              owner.runtime.native('main', id, args, owner.main.machine, owner.main),
            actors = [],
            expectFrame = async (owner, colors) => {
              const renderer = owner.stageRenderer;
              await renderer.render(owner.graphics.stage, null, owner.particles.drawItems());
              for (const [index, rgba] of colors.entries()) {
                const pixels = renderer.renderer.ctx.getImageData(4 + 12 * index, 3, 8, 6).data,
                  expected = new Uint8ClampedArray(8 * 6 * 4);
                for (let i = 0; i < 8 * 6; i++) expected.set(rgba, i * 4);
                assert.deepEqual(pixels, expected, 'replacement uses the original current frame');
              }
            };
          let fresh;
          try {
            await world.initialize('main.kcs');
            const plane = await world.objects.create({ kind: 2, parent: world.root, name: 'VRAM' });
            await placeBrowserNativePlane(world, plane, { width: 64, height: 48, priority: 300 });
            const p = world.nativeEngine.process,
              records = 0x80000020,
              rawRecordSize = sdk ? 72 : 136,
              m = world.main.machine;
            m.writeString('replacement.hg2', 256);
            m.bytes(records, rawRecordSize).fill(0xa5);
            assert.deepEqual(await call(world, 0x2bf, 256, records, 1), { control: 1, value: 1 });
            assert.equal(m.load(records), 1);
            const raw = m.load(records + 4),
              bitmaps = await world.getNativeFeature('bitmap-memory'),
              makeBitmap = async (color) => {
                const bitmap = (await call(world, 0x70, 8, 6)).value;
                await call(world, 0x75, bitmap, 0, 0, 8, 6, color);
                return bitmap;
              },
              previous = await makeBitmap(0xffff0000),
              next = await makeBitmap(0xff0000ff),
              replacement = await makeBitmap(0xffffff00),
              newWrapper = await bitmaps.wrapper(replacement),
              refs = [raw, newWrapper].map((wrapper) => p.load(p.load(wrapper) + 80));
            for (const [i, kind] of [26, 27].entries()) {
              const script = await world.spawnScript(kind + '.kcs', { parent: world.main.id }),
                vm = script.machine,
                startPacket = vm.allocate(56),
                replacePacket = vm.allocate(24),
                x = 4 + 12 * i,
                input = [
                  4,
                  previous,
                  0,
                  0,
                  next,
                  0,
                  0,
                  ...(kind === 26 ? [previous, x, 3, 0, 0, 0, 0] : [x, 3, 8, 6]),
                ];
              vm.store(96, world.nativeTaskID(world.main.id));
              vm.store(100, startPacket);
              vm.store(104, replacePacket);
              input.forEach((word, index) => vm.store(startPacket + 4 * index, word));
              vm.bytes(replacePacket, 24).fill(0xa5);
              vm.store(replacePacket + 4, raw);
              vm.store(replacePacket + 16, replacement);
              const before = vm.bytes(replacePacket, 24).slice();
              await world.runtime.scheduler.execute(script);
              const id = world.resolveTaskID(vm.load(128), script.id),
                pointer = world.objects.objects.get(id).implementation.pointer,
                size = kind === 26 ? 200 : 176,
                work = p.load(pointer + (kind === 26 ? 164 : 152));
              assert.equal(vm.load(132), 1);
              assert.ok(p.allocations.has(work));
              actors.push({ id, script, pointer, size, work, replacePacket, before });
            }
            await world.tick();
            await expectFrame(world, [
              [255, 0, 0, 255],
              [191, 0, 63, 255],
            ]);
            for (const actor of actors) {
              const { pointer, size, script, replacePacket, before } = actor,
                expected = p.read(pointer, size),
                fields = new DataView(expected.buffer);
              fields.setUint32(112, raw, true);
              fields.setUint32(124, newWrapper, true);
              assert.equal(
                (await world.runtime.scheduler.send(script.id, [1, 2, 3, 4])).accepted,
                true,
              );
              assert.deepEqual(p.read(pointer, size), expected, 'CA preserves running state');
              assert.deepEqual(
                script.machine.bytes(replacePacket, 24),
                before,
                'CA preserves the VM packet',
              );
            }
            await world.tick();
            await expectFrame(world, [
              [0, 255, 0, 255],
              [127, 255, 0, 255],
            ]);
            fresh = make();
            await fresh.restore(structuredClone(world.snapshot()));
            await expectFrame(fresh, [
              [0, 255, 0, 255],
              [127, 255, 0, 255],
            ]);
            await fresh.tick();
            await expectFrame(fresh, [
              [127, 255, 0, 255],
              [191, 255, 0, 255],
            ]);
            const rp = fresh.nativeEngine.process;
            for (const { id, script, pointer, work } of actors) {
              assert.equal(fresh.objects.objects.get(id).implementation.pointer, pointer);
              assert.equal(rp.load(pointer + 112), raw);
              assert.equal(rp.load(pointer + 124), newWrapper);
              assert.equal(
                (await fresh.runtime.scheduler.send(script.id, [4, 3, 2, 1])).accepted,
                true,
              );
              await fresh.objects.release(id);
              assert.equal(rp.allocations.has(work), false);
            }
            await expectFrame(fresh, [
              [255, 255, 0, 255],
              [255, 255, 0, 255],
            ]);
            await expectFrame(world, [
              [0, 255, 0, 255],
              [127, 255, 0, 255],
            ]);
            assert.deepEqual(
              [raw, newWrapper].map((wrapper) => rp.load(rp.load(wrapper) + 80)),
              refs,
            );
            assert.deepEqual(await call(fresh, 0x2c0, records, 1), { control: 2 });
          } finally {
            await fresh?.close({ flushFiles: false });
            await world.close({ flushFiles: false });
          }
        },
        { profile, names, sdk },
      );
    },
  );
}

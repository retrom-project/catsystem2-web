// SPDX-License-Identifier: MPL-2.0
import { test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { encodeHG2 } from '../../src/formats/hg2.mjs';
import { kcsProgram } from '../helpers.mjs';

const programSize = (ops) => ops.reduce((offset, op) => offset + 1 + (op.length - 1) * 5, 0);
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
  waitingPC = programSize(start);

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
        replacePC = waitingPC + programSize(replace),
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

  test(
    profile + ' KCS C9 and C7 use the original Raster graph and packet receivers',
    async ({ page }) => {
      const sdk = profile.startsWith('sdk-');
      test.skip(!process.env[variable] || (!sdk && !process.env.CATSYSTEM2_EMOTE_DLL));
      test.setTimeout(180000);
      const begin = [
          [37, 18],
          ...start.slice(1),
          target,
          [37, 1],
          [37, 0xffffffff],
          [43, 0xc9, 12],
        ],
        adjust = [
          ...wait,
          [39, programSize(begin)],
          target,
          [37, 0],
          [37, [0x14, 104]],
          [43, 0xc9, 12],
        ],
        sendMatrix = [
          ...wait,
          [39, programSize(begin) + programSize(adjust)],
          target,
          [37, [0x14, 108]],
          [43, 0xc7, 8],
          [37, [0x14, 92]],
          [37, [0x14, 108]],
          [43, 0xc7, 8],
        ],
        files = new Map([
          ['main.kcs', kcsProgram([...wait, [39, 0], [41, 0]])],
          [
            'raster.kcs',
            kcsProgram(
              [
                ...begin,
                ...adjust,
                ...sendMatrix,
                ...wait,
                [39, programSize(begin) + programSize(adjust) + programSize(sendMatrix)],
                target,
                [43, 0xc6, 4],
                [59],
              ],
              [[64, 'Authored Raster']],
            ),
          ],
        ]),
        names = await openAreaFixture(page, profile, variable, files);
      await page.evaluate(
        async ({ profile, names, sdk }) => {
          const {
              browserNativeWorld,
              browserAssert: assert,
              placeBrowserNativePlane,
            } = await import('/tests/fixtures/browser-native-world.mjs'),
            { floatBits } = await import('/src/kcs.mjs'),
            files = new Map(
              await Promise.all(
                names.map(async (name) => {
                  const response = await fetch('/area-effect-fixture/' + name);
                  if (!response.ok) throw new Error('Missing Raster fixture ' + name);
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
            render = async (owner) => {
              const stage = owner.stageRenderer;
              await stage.render(owner.graphics.stage, null, owner.particles.drawItems());
              return stage.renderer.ctx.getImageData(0, 0, 64, 48).data;
            },
            pixel = (image, x, y) =>
              Array.from(image.slice((64 * y + x) * 4, (64 * y + x) * 4 + 4));
          let fresh, detach;
          try {
            await world.initialize('main.kcs');
            const p = world.nativeEngine.process,
              platform = await world.getNativeFeature('graphics-platform'),
              plane = await world.objects.create({
                kind: 2,
                parent: world.root,
                name: 'Warp target',
              }),
              color = [17, 210, 60, 255],
              graph = world.nativeTaskID(plane);
            await placeBrowserNativePlane(world, plane, {
              width: 32,
              height: 24,
              position: [12, 8, 0],
              priority: 300,
            });
            const image = (await call(world, 0x70, 32, 24)).value;
            await call(world, 0x75, image, 0, 0, 32, 24, 0xff11d23c);
            await call(world, 0x73, 0, 0, 0, 32, 24, image, 0, 0, 32, 24);
            const baseline = await render(world),
              descriptor = platform.descriptor(graph),
              model = p.load(descriptor + 16) || p.load(descriptor + 8),
              callback = sdk ? 0x4c8db0 : 0x5ee480;
            assert.deepEqual(pixel(baseline, 14, 10), color);
            assert.deepEqual(pixel(baseline, 47, 10), [0, 0, 0, 255]);
            const script = await world.spawnScript('raster.kcs', { parent: world.main.id }),
              vm = script.machine,
              init = vm.allocate(20),
              update = 0x80000120,
              matrix = vm.allocate(68) + 1,
              matrixBytes = Uint8Array.from({ length: 64 }, (_, i) => (i * 23 + 17) & 255),
              first = [graph, 0x80000001, floatBits(0), floatBits(64), floatBits(8)],
              next = [0xffffffff, 0x87654321, floatBits(12), floatBits(64), floatBits(8)];
            vm.store(92, graph);
            vm.store(96, world.nativeTaskID(world.main.id));
            vm.store(100, init);
            vm.store(104, update);
            vm.store(108, matrix);
            vm.bytes(matrix, 64).set(matrixBytes);
            first.forEach((word, i) => vm.store(init + i * 4, word));
            vm.bytes(update, 24).fill(0xa5);
            next.forEach((word, i) => vm.store(update + i * 4, word));
            const original = vm.bytes(update, 24).slice();
            await world.runtime.scheduler.execute(script);
            const nativeID = vm.load(128),
              id = world.resolveTaskID(nativeID, script.id),
              effect = world.objects.objects.get(id).implementation,
              pointer = effect.pointer;
            assert.equal(vm.load(132), 1);
            assert.equal(p.load(pointer + 108), platform.refs.manager);
            assert.equal(p.load(model + 236), callback);
            assert.equal(p.load(model + 244), pointer);
            let draws = 0;
            detach = p.beforeInstruction(
              callback,
              'observe original Raster graph callback',
              () => draws++,
            );
            await world.tick();
            assert.deepEqual(await render(world), baseline, 'zero amplitude preserves the graph');
            assert.ok(draws > 0, 'original renderer executes the Raster callback');
            const phase = p.load(pointer + 140);
            assert.equal(
              (await world.runtime.scheduler.send(script.id, [1, 2, 3, 4])).accepted,
              true,
            );
            assert.deepEqual(
              [112, 120, 124, 128, 132, 140].map((at) => p.load(pointer + at)),
              [graph, 1, floatBits(12), floatBits(1 / 64), floatBits(8), phase],
            );
            assert.deepEqual(vm.bytes(update, 24), original);
            const warped = await render(world);
            assert.deepEqual(pixel(warped, 14, 10), [0, 0, 0, 255], 'the left edge moves');
            assert.deepEqual(
              pixel(warped, 47, 10),
              color,
              'the deformed graph covers the right edge',
            );

            detach();
            detach = undefined;
            fresh = make();
            await fresh.restore(structuredClone(world.snapshot()));
            const rp = fresh.nativeEngine.process;
            assert.equal(fresh.objects.objects.get(id).implementation.pointer, pointer);
            assert.equal(rp.load(model + 236), callback);
            assert.deepEqual(await render(fresh), warped);
            await world.tick();
            await fresh.tick();
            const moving = await render(world);
            assert.ok(
              moving.some((byte, i) => byte !== warped[i]),
              'Raster phase advances',
            );
            assert.deepEqual(
              await render(fresh),
              moving,
              'fresh graph follows the same native phase',
            );
            const expectedMessage = sdk ? 257 : 262,
              receiverPackets = [],
              actorState = rp.read(pointer, 148),
              stopObserving = rp.beforeInstruction(
                sdk ? 0x4b9610 : 0x5dd3e0,
                'observe original C7 packet',
                () => {
                  const sp = rp.cpu.reg_read_i32(rp.uc.X86_REG_ESP) >>> 0,
                    packet = rp.load(sp + 4);
                  if (rp.load(packet + 8) !== expectedMessage) return;
                  const value = rp.load(packet + 16);
                  receiverPackets.push({
                    target: rp.load(packet),
                    from: rp.load(packet + 4),
                    w: rp.load(packet + 12),
                    flags: rp.load(packet + 20),
                    bytes: [...rp.read(value, 64)],
                  });
                  rp.store(value, 0xa5a55a5a);
                },
              );
            try {
              assert.equal(
                (await fresh.runtime.scheduler.send(script.id, [4, 3, 2, 1])).accepted,
                true,
              );
            } finally {
              stopObserving();
            }
            assert.deepEqual(
              receiverPackets,
              [nativeID, graph].map((target) => ({
                target,
                from: fresh.nativeTaskID(script.id),
                w: 0,
                flags: 0,
                bytes: [...matrixBytes],
              })),
            );
            const restored = fresh.runtime.scheduler.tasks.get(script.id);
            assert.deepEqual(
              restored.machine.bytes(matrix, 64),
              matrixBytes,
              'C7 delivers a stack copy',
            );
            assert.deepEqual(rp.read(pointer, 148), actorState, 'Raster ignores the matrix packet');
            assert.deepEqual(await render(fresh), moving, 'C7 preserves the active graph');
            assert.equal(
              (await fresh.runtime.scheduler.send(script.id, [4, 3, 2, 1])).accepted,
              true,
            );
            assert.equal(rp.load(model + 236), 0);
            assert.equal(rp.load(model + 244), 0);
            assert.deepEqual(
              await render(fresh),
              baseline,
              'native stop restores unwarped vertices',
            );
            await world.objects.release(id);
            assert.equal(
              p.load(model + 236),
              0,
              'active destruction detaches the original callback',
            );
            assert.equal(p.allocations.has(pointer), false);
            assert.deepEqual(await render(world), baseline);

            const hydro = await fresh.objects.create({
                kind: 25,
                parent: fresh.root,
                name: 'Hydro',
              }),
              hydroID = fresh.nativeTaskID(hydro),
              hydroPointer = fresh.objects.objects.get(hydro).implementation.pointer,
              untouched = rp.read(hydroPointer, 180);
            assert.deepEqual(await call(fresh, 0xc4, hydroID, 0xffffffff), { control: 2 });
            assert.deepEqual(await call(fresh, 0xc9, hydroID, 0, 0xffffffff), { control: 2 });
            assert.deepEqual(rp.read(hydroPointer, 180), untouched);
            const memory = await fresh.getNativeFeature('task-memory');
            assert.deepEqual(await call(fresh, 0xc8, hydroID), {
              control: 1,
              value: await memory.pointer(fresh.main.id),
            });
            await fresh.objects.release(hydro);
            assert.equal(rp.allocations.has(hydroPointer), false);
          } finally {
            detach?.();
            await fresh?.close({ flushFiles: false });
            await world.close({ flushFiles: false });
          }
        },
        { profile, names, sdk },
      );
    },
  );

  test(
    profile + ' KCS Wipe3 and WipeAlpha3 match original transition frames after restore',
    async ({ page }) => {
      const sdk = profile.startsWith('sdk-');
      test.skip(!process.env[variable] || (!sdk && !process.env.CATSYSTEM2_EMOTE_DLL));
      test.setTimeout(180000);
      const maskRamp = [0, 64, 128, 192, 255, 192, 128, 64],
        mask = Uint8Array.from(
          { length: 8 * 6 * 4 },
          (_, i) => [129, 53, maskRamp[(i >>> 2) % 8], 255][i % 4],
        ),
        files = new Map([
          ['mask.hg2', await encodeHG2({ width: 8, height: 6, rgba: mask }, { crop: false })],
          ['main.kcs', kcsProgram([...wait, [39, 0], [41, 0]])],
          ...[30, 31].map((kind) => [
            kind + '.kcs',
            kcsProgram(
              [
                [37, kind],
                ...start.slice(1),
                ...wait,
                [39, waitingPC],
                target,
                [43, 0xcb, 4],
                target,
                [43, 0xc8, 4],
                [38, 136],
                [59],
              ],
              [[64, 'Authored extended wipe']],
            ),
          ]),
        ]),
        names = await openAreaFixture(page, profile, variable, files);
      await page.evaluate(
        async ({ profile, names, sdk, maskRamp }) => {
          const {
              browserNativeWorld,
              browserAssert: assert,
              placeBrowserNativePlane,
            } = await import('/tests/fixtures/browser-native-world.mjs'),
            files = new Map(
              await Promise.all(
                names.map(async (name) => {
                  const response = await fetch('/area-effect-fixture/' + name);
                  if (!response.ok) throw new Error('Missing extended wipe fixture ' + name);
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
            actors = [],
            call = (owner, id, ...args) =>
              owner.runtime.native('main', id, args, owner.main.machine, owner.main),
            weight = (frame, x) =>
              Math.max(0, Math.min(256, 128 * (frame - (4 - Math.floor((4 * maskRamp[x]) / 255))))),
            checkFrame = async (owner, frame, forced = false) => {
              const stage = owner.stageRenderer;
              await stage.render(owner.graphics.stage, null, owner.particles.drawItems());
              const pixels = stage.renderer.ctx.getImageData(0, 0, 64, 48).data,
                p = owner.nativeEngine.process;
              for (const { alpha, fadeIn, x, work } of actors) {
                const data = p.load(work + 12),
                  stride = p.load(work + 20);
                for (let row = 0; row < 6; row++)
                  for (let col = 0; col < 7; col++) {
                    const factor = weight(alpha && !forced ? Math.min(frame, 5) : frame, col),
                      component = (255 * factor) >> 8,
                      a = fadeIn ? component : 255 - component,
                      pixel = (64 * (3 + row) + x + col) * 4,
                      expected = alpha ? [a, 0, 0] : [(255 * (256 - factor)) >> 8, 0, component];
                    if (alpha)
                      assert.equal(
                        p.load(data + row * stride + 4 * col) >>> 24,
                        a,
                        'original alpha work pixel',
                      );
                    assert.deepEqual(
                      [...pixels.slice(pixel, pixel + 3)],
                      expected,
                      'original transition is visible on the VRAM plane',
                    );
                  }
              }
              return pixels;
            };
          let fresh;
          try {
            await world.initialize('main.kcs');
            const plane = await world.objects.create({ kind: 2, parent: world.root, name: 'VRAM' });
            await placeBrowserNativePlane(world, plane, { width: 64, height: 48, priority: 300 });
            const p = world.nativeEngine.process,
              stride = sdk ? 72 : 136,
              resource = 0x80000020,
              vm = world.main.machine;
            vm.writeString('mask.hg2', 256);
            vm.bytes(resource, stride).fill(0xa5);
            assert.deepEqual(await call(world, 0x2bf, 256, resource, 1), { control: 1, value: 1 });
            assert.equal(vm.load(resource), 1);
            const mask = vm.load(resource + 4),
              makeImage = async (color) => {
                const handle = (await call(world, 0x70, 8, 6)).value;
                await call(world, 0x75, handle, 0, 0, 8, 6, color);
                return handle;
              },
              src = await makeImage(0xffff0000),
              next = await makeImage(0xff0000ff),
              picture = await makeImage(0xffff0000),
              bitmaps = await world.getNativeFeature('bitmap-memory'),
              sourceWrapper = await bitmaps.wrapper(src),
              destinationWrapper = await bitmaps.wrapper(next),
              pictureWrapper = await bitmaps.wrapper(picture),
              borrowed = [sourceWrapper, destinationWrapper, pictureWrapper, mask],
              refs = borrowed.map((wrapper) => p.load(p.load(wrapper) + 80)),
              sourcePixel = p.load(p.load(sourceWrapper) + 12) + 7 * 4;
            await call(world, 0x75, src, 7, 0, 1, 6, 0x00ff0000);
            assert.equal(p.load(sourcePixel), 0x00ff0000);
            for (const [index, [kind, fadeIn]] of [
              [30, 0],
              [31, 0],
              [31, 1],
            ].entries()) {
              const alpha = kind === 31,
                x = 4 + index * 12,
                script = await world.spawnScript(kind + '.kcs', { parent: world.main.id }),
                machine = script.machine,
                packet = machine.allocate(68) + 1,
                fields = alpha
                  ? [4, 2, picture, 0, 0, mask, x, 3, 8, 6, fadeIn, 0, 0]
                  : [4, 2, src, 0, 0, next, 0, 0, mask, x, 3, 0, 0, 0, 0];
              machine.store(96, world.nativeTaskID(world.main.id));
              machine.store(100, packet);
              machine.bytes(packet, 64).fill(0xa5);
              fields.forEach((word, i) => machine.store(packet + i * 4, word));
              const before = machine.bytes(packet, 64).slice();
              await world.runtime.scheduler.execute(script);
              const id = world.resolveTaskID(machine.load(128), script.id),
                pointer = world.objects.objects.get(id).implementation.pointer,
                work = p.load(pointer + (alpha ? 160 : 168));
              assert.equal(p.load(pointer + 64), kind);
              assert.equal(machine.load(132), 1);
              assert.ok(p.allocations.has(work));
              assert.deepEqual(machine.bytes(packet, 64), before, 'C4 preserves all VM words');
              actors.push({ alpha, fadeIn, x, id, script, pointer, work });
            }
            assert.equal(
              p.load(sourcePixel),
              0x000000ff,
              'Wipe3 prepares the actual borrowed source',
            );
            const currentSource = await world.graphics.images.get(src).pixels();
            assert.deepEqual(
              [...currentSource.slice(7 * 4, 8 * 4)],
              [0, 0, 255, 0],
              'host bitmap alias observes original transparent RGB preparation',
            );
            await world.tick();
            await checkFrame(world, 1);
            await world.tick();
            const before = await checkFrame(world, 2);
            fresh = make();
            await fresh.restore(structuredClone(world.snapshot()));
            assert.deepEqual(await checkFrame(fresh, 2), before);
            await world.tick();
            await fresh.tick();
            assert.deepEqual(await checkFrame(fresh, 3), await checkFrame(world, 3));
            const rp = fresh.nativeEngine.process;
            for (const actor of actors) {
              assert.equal(
                fresh.objects.objects.get(actor.id).implementation.pointer,
                actor.pointer,
              );
              const restored = fresh.runtime.scheduler.tasks.get(actor.script.id);
              assert.equal(
                (await fresh.runtime.scheduler.send(restored.id, [1, 2, 3, 4])).accepted,
                true,
              );
              assert.equal(restored.machine.load(136), 0, 'CB forced completion clears active');
            }
            await checkFrame(fresh, 6, true);
            for (let frame = 4; frame <= 6; frame++) {
              await world.tick();
              await checkFrame(world, frame);
            }
            for (const { alpha, id, pointer, work } of actors) {
              assert.deepEqual(await call(world, 0xc8, world.nativeTaskID(id)), {
                control: 1,
                value: 0,
              });
              const packet = new Uint8Array(alpha ? 12 : 24),
                v = new DataView(packet.buffer);
              v.setUint32(8, destinationWrapper, true);
              if (!alpha) v.setUint32(20, pictureWrapper, true);
              await fresh.sendEngine(id, fresh.main.id, 260, 0, 0, {
                payload: {
                  bytes: (at, size) => {
                    assert.equal(at, 0);
                    assert.equal(size, packet.length);
                    return packet;
                  },
                },
              });
              assert.equal(rp.load(pointer + 116), destinationWrapper);
              if (!alpha) assert.equal(rp.load(pointer + 128), pictureWrapper);
              await fresh.objects.release(id);
              assert.equal(rp.allocations.has(work), false);
            }
            assert.deepEqual(
              borrowed.map((wrapper) => rp.load(rp.load(wrapper) + 80)),
              refs,
            );
            assert.deepEqual(await call(fresh, 0x2c0, resource, 1), { control: 2 });
          } finally {
            await fresh?.close({ flushFiles: false });
            await world.close({ flushFiles: false });
          }
        },
        { profile, names, sdk, maskRamp },
      );
    },
  );

  test(
    profile + ' KCS GlassBreak animates original textured triangles across restore',
    async ({ page }) => {
      const sdk = profile.startsWith('sdk-');
      test.skip(!process.env[variable] || (!sdk && !process.env.CATSYSTEM2_EMOTE_DLL));
      test.setTimeout(180000);
      const files = new Map([
          ['main.kcs', kcsProgram([...wait, [39, 0], [41, 0]])],
          [
            'glass.kcs',
            kcsProgram(
              [
                [37, 20],
                ...start.slice(1),
                ...wait,
                [39, waitingPC],
                target,
                [43, 0xc6, 4],
                target,
                [43, 0xc8, 4],
                [38, 136],
                [59],
              ],
              [[64, 'Authored GlassBreak']],
            ),
          ],
        ]),
        names = await openAreaFixture(page, profile, variable, files);
      await page.evaluate(
        async ({ profile, names, sdk }) => {
          const {
              browserNativeWorld,
              browserAssert: assert,
              placeBrowserNativePlane,
            } = await import('/tests/fixtures/browser-native-world.mjs'),
            { floatBits } = await import('/src/kcs.mjs'),
            files = new Map(
              await Promise.all(
                names.map(async (name) => {
                  const response = await fetch('/area-effect-fixture/' + name);
                  if (!response.ok) throw new Error('Missing GlassBreak fixture ' + name);
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
            render = async (owner) => {
              const stage = owner.stageRenderer;
              await stage.render(owner.graphics.stage, null, owner.particles.drawItems());
              return stage.renderer.ctx.getImageData(0, 0, 64, 48).data;
            },
            pixel = (image, x, y) => [...image.slice((64 * y + x) * 4, (64 * y + x) * 4 + 4)],
            words = (p, address, count) =>
              Array.from({ length: count }, (_, i) => p.load(address + 4 * i));
          let fresh, detach;
          try {
            await world.initialize('main.kcs');
            world.random.real.seed(0x8120719);
            const p = world.nativeEngine.process,
              platform = await world.getNativeFeature('graphics-platform'),
              plane = await world.objects.create({
                kind: 2,
                parent: world.root,
                name: 'Textured glass',
              }),
              graph = world.nativeTaskID(plane),
              color = [35, 211, 87, 255];
            await placeBrowserNativePlane(world, plane, {
              width: 28,
              height: 20,
              position: [12, 8, 0],
              priority: 300,
            });
            const image = (await call(world, 0x70, 28, 20)).value;
            await call(world, 0x75, image, 0, 0, 28, 20, 0xff23d357);
            await call(world, 0x73, 0, 0, 0, 28, 20, image, 0, 0, 28, 20);
            const baseline = await render(world),
              descriptor = platform.descriptor(graph),
              [geometry, texture] = words(p, descriptor + 12, 2),
              callback = sdk ? 0x4ca2a0 : 0x5ef970;
            assert.ok(geometry && texture, 'original plane has color and textured triangle models');
            assert.equal(p.load(texture + 396), 2);
            assert.deepEqual(pixel(baseline, 15, 11), color);
            assert.deepEqual(pixel(baseline, 10, 11), [0, 0, 0, 255]);

            const script = await world.spawnScript('glass.kcs', { parent: world.main.id }),
              vm = script.machine,
              input = vm.allocate(20) + 1,
              init = [graph, floatBits(6), 4];
            vm.store(96, world.nativeTaskID(world.main.id));
            vm.store(100, input);
            vm.bytes(input, 16).fill(0xa5);
            init.forEach((word, i) => vm.store(input + 4 * i, word));
            const packet = vm.bytes(input, 16).slice();
            await world.runtime.scheduler.execute(script);
            const id = world.resolveTaskID(vm.load(128), script.id),
              effect = world.objects.objects.get(id).implementation,
              pointer = effect.pointer,
              shards = p.load(pointer + 124);
            assert.equal(vm.load(132), 1);
            assert.deepEqual(vm.bytes(input, 16), packet);
            assert.deepEqual(words(p, pointer + 112, 3), init);
            assert.equal(p.load(pointer + 108), platform.refs.manager);
            assert.equal(p.load(pointer + 136), 2);
            assert.equal(p.load(shards - 4), 1);
            assert.equal(p.allocations.get(shards - 4), 4 + 2 * 128);
            assert.deepEqual(words(p, texture + 236, 3), [callback, 0, pointer]);

            const indices = new Set();
            detach = p.beforeInstruction(
              callback,
              'observe original GlassBreak vertex callback',
              () => {
                const esp = p.cpu.reg_read_i32(p.uc.X86_REG_ESP) >>> 0;
                const [actor, count, , triangle] = words(p, esp + 4, 4);
                assert.equal(actor, pointer);
                assert.equal(count, 1);
                indices.add(triangle);
              },
            );
            assert.deepEqual(await render(world), baseline, 'fresh shard transforms are identity');
            assert.deepEqual(
              [...indices].sort(),
              [0, 1],
              'both original triangles call the effect',
            );
            const initial = p.read(shards, 256);
            await world.tick();
            const moving = await render(world),
              state = p.read(shards, 256);
            assert.notDeepEqual(state, initial);
            assert.notDeepEqual(
              moving,
              baseline,
              'the original transform changes the visible image',
            );
            assert.ok(moving.some((value, i) => i % 4 === 1 && value === color[1]));
            detach();
            detach = null;

            fresh = make();
            await fresh.restore(structuredClone(world.snapshot()));
            const rp = fresh.nativeEngine.process;
            assert.equal(fresh.objects.objects.get(id).implementation.pointer, pointer);
            assert.equal(rp.load(pointer + 124), shards);
            assert.deepEqual(rp.read(shards, 256), state);
            assert.deepEqual(words(rp, texture + 236, 3), [callback, 0, pointer]);
            assert.deepEqual(await render(fresh), moving);
            await world.tick();
            await fresh.tick();
            assert.deepEqual(rp.read(shards, 256), p.read(shards, 256));
            assert.deepEqual(await render(fresh), await render(world));

            const resumed = await fresh.runtime.scheduler.send(script.id, [1, 2, 3, 4]);
            assert.equal(resumed.accepted, true);
            assert.equal(fresh.runtime.scheduler.tasks.get(script.id).machine.load(136), 0);
            assert.deepEqual(words(rp, texture + 236, 3), [0, 0, 0]);
            assert.deepEqual(await render(fresh), baseline, 'C6 removes the native deformation');
            await world.tick();
            await world.tick();
            assert.deepEqual(await call(world, 0xc8, world.nativeTaskID(id)), {
              control: 1,
              value: 0,
            });
            assert.deepEqual(words(p, texture + 236, 3), [0, 0, 0]);
            assert.deepEqual(await render(world), baseline, 'duration also removes the callback');

            const replacement = Uint32Array.of(graph, floatBits(4), 12);
            await world.sendEngine(id, world.main.id, 267, 0, 0, {
              payload: {
                bytes: (address, size) => {
                  assert.equal(address, 0);
                  assert.equal(size, 12);
                  return new Uint8Array(replacement.buffer);
                },
              },
            });
            assert.deepEqual(words(p, pointer + 112, 3), [...replacement]);
            await call(world, 0xc5, world.nativeTaskID(id));
            const restarted = p.load(pointer + 124);
            assert.equal(p.load(pointer + 140), 1);
            assert.deepEqual(words(p, texture + 236, 3), [callback, 0, pointer]);
            await world.objects.release(id);
            assert.equal(p.allocations.has(pointer), false);
            assert.equal(p.allocations.has(restarted - 4), false);
            assert.deepEqual(words(p, texture + 236, 3), [0, 0, 0]);
            assert.deepEqual(
              await render(world),
              baseline,
              'active destruction leaves the borrowed plane',
            );
            await fresh.objects.release(id);
            assert.equal(rp.allocations.has(shards - 4), false);
          } finally {
            detach?.();
            await fresh?.close({ flushFiles: false });
            await world.close({ flushFiles: false });
          }
        },
        { profile, names, sdk },
      );
    },
  );
}

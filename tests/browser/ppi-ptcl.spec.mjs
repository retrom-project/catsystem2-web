// SPDX-License-Identifier: MPL-2.0
import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { kcsProgram } from '../helpers.mjs';

test('SDK snow keeps original PTCL state, submitted vertices and matched-texture pixels', async ({
  page,
}) => {
  const exe = process.env.CATSYSTEM2_SDK_EXE,
    assets = ['scene/spl2_ptc.cst', 'ptcl/snow.kcs', 'image/fg_snow.hg3'];
  test.skip(!exe || !assets.every((path) => existsSync(resolve(dirname(exe), path))));
  test.setTimeout(180000);
  const files = new Map([
    ['engine.exe', await readFile(exe)],
    ['main.kcs', kcsProgram([[37, 1024], [43, 0x47, 4], [59]])],
    ...(await Promise.all(
      assets.map(async (path) => [path, await readFile(resolve(dirname(exe), path))]),
    )),
  ]);
  expect(assets.map((path) => createHash('sha256').update(files.get(path)).digest('hex'))).toEqual([
    'ccd9ff8be33d76b5a4707dce8dbed4d7c03ad5e41dcc5e06697dc0b1e48bddb8',
    '2aa8485f69abbbe046537582284284458400db577e02b3daf13013a740713bd6',
    'e017a3810b36b3ef510757ce7374e2e3dd74daa60df27f70b2fa75e24f74676c',
  ]);
  for (const file of ['browser-native-world.mjs', 'original-ptcl-task.mjs'])
    await page.route('**/tests/fixtures/' + file, (route) =>
      route.fulfill({
        path: new URL('../fixtures/' + file, import.meta.url).pathname,
        contentType: 'text/javascript',
      }),
    );
  await page.route('**/ptcl-scene-fixture/**', (route) => {
    const name = decodeURIComponent(
        new URL(route.request().url()).pathname.slice('/ptcl-scene-fixture/'.length),
      ),
      bytes = files.get(name);
    return route.fulfill(bytes ? { body: Buffer.from(bytes) } : { status: 404, body: '' });
  });
  await page.goto('/');
  const result = await page.evaluate(
    async (names) => {
      const [
        { browserNativeWorld, placeBrowserNativePlane },
        { originalPTCLTask, particleFields },
        { readScene },
        { floatBits },
      ] = await Promise.all([
        import('/tests/fixtures/browser-native-world.mjs'),
        import('/tests/fixtures/original-ptcl-task.mjs'),
        import('/src/formats/scene.mjs'),
        import('/src/kcs.mjs'),
      ]);
      const files = new Map(
          await Promise.all(
            names.map(async (name) => [
              name,
              new Uint8Array(
                await (
                  await fetch('/ptcl-scene-fixture/' + encodeURIComponent(name))
                ).arrayBuffer(),
              ),
            ]),
          ),
        ),
        scene = await readScene(files.get('scene/spl2_ptc.cst')),
        command = scene.lines.find(({ text }) => text.startsWith('particle 0 snow ')),
        [, , program, texture, count, priority, ...registers] = command.text.split(' '),
        width = 800,
        height = 600,
        make = () =>
          browserNativeWorld({
            profile: 'sdk-4.01-engine-2.6.1.74',
            files,
            width,
            height,
            storage: { read: async () => null, write: async () => true },
          }),
        source = make(),
        browser = make();
      let raw, fresh, rawID, taskMemory;
      try {
        const begin = async (world) => {
          await world.initialize('main.kcs');
          world.random.integer.seed(4357);
          world.random.real.seed(4357);
          const ground = await world.objects.create({ kind: 2, parent: world.root });
          await placeBrowserNativePlane(world, ground, {
            width,
            height,
            color: 0xff112244,
            priority: 1000,
          });
        };
        await begin(source);
        await begin(browser);
        const render = async (world, atlas) => {
          const gpu = world.stageRenderer.gpu,
            draw = gpu.drawGeometry,
            words = [];
          let texture;
          gpu.drawGeometry = function (geometry, image, options) {
            if (image.width > 1) {
              // The original renderer submits each strip as two triangles.
              // The browser submits the same vertices in one bank batch.
              const vertices = atlas
                ? geometry.flatMap((entry) => entry.vertices)
                : [...geometry[0].vertices, geometry[1].vertices[2]];
              for (const { x, y, z, w, color, u, v } of vertices)
                words.push(
                  floatBits(x),
                  floatBits(y),
                  floatBits(z),
                  floatBits(w),
                  color,
                  floatBits(u),
                  floatBits(v),
                );
              if (atlas) image = atlas;
              else
                texture ??= { width: image.width, height: image.height, rgba: image.rgba.slice() };
            }
            return draw.call(this, geometry, image, options);
          };
          try {
            await world.stageRenderer.render(
              world.graphics.stage,
              null,
              world.particles.drawItems(),
            );
          } finally {
            gpu.drawGeometry = draw;
          }
          const pixels = new Uint8Array(
            await crypto.subtle.digest('SHA-256', gpu.pixels()),
          ).toHex();
          return { words, texture, pixels };
        };
        const ground = (await render(browser)).pixels;
        await source.getNativeFeature('engine-files');
        rawID = await source.objects.create({ kind: 16, parent: source.root });
        taskMemory = await source.getNativeFeature('task-memory');
        raw = await originalPTCLTask(
          source.nativeEngine,
          source.nativeEngine.features.get('graphics-platform').refs.view,
          {
            id: source.nativeTaskID(rawID),
            bind: (pointer) =>
              taskMemory.bind(source.objects.objects.get(rawID), pointer, { ready: false }),
            program: 'ptcl/' + program + '.kcs',
            texture: 'image/' + texture + '.hg3',
            count: Number(count),
            priority: Number(priority),
            registers: registers.map(Number),
          },
        );
        await raw.send(315);
        const task = await browser.objects.create({ kind: 16, parent: browser.root }),
          nativeID = browser.nativeTaskID(task),
          m = browser.main.machine,
          call = (id, args) => browser.runtime.native('main', id, args, m, browser.main);
        m.writeString('ptcl/' + program + '.kcs', 128);
        m.writeString('image/' + texture + '.hg3', 256);
        registers.map(Number).forEach((value, i) => m.store(384 + i * 4, floatBits(value)));
        const loaded = await call(0x10f, [
          nativeID,
          128,
          256,
          Number(count),
          floatBits(Number(priority)),
          384,
        ]);
        await call(0x110, [nativeID]);
        const bank = browser.particles.get(task).bank,
          pixels = [];
        let atlas;
        for (const frame of [2, 3, 4, 17, 62, 63]) {
          // Jumping the same task clock in both worlds also exercises frame delta.
          source.frame = browser.frame = frame - 1;
          await source.tick();
          await raw.step(frame);
          await browser.tick();
          for (const [key, offset, stride] of particleFields) {
            const field = bank.instance[key],
              expected = raw.field(offset, stride),
              actual = new Uint8Array(field.buffer, field.byteOffset, field.byteLength);
            if (
              actual.length !== expected.length ||
              !actual.every((byte, i) => byte === expected[i])
            )
              throw new Error('PTCL ' + key + ' differs at frame ' + frame);
          }
          const expectedData = raw.data(bank.instance.machine.data.length);
          if (!bank.instance.machine.data.every((byte, i) => byte === expectedData[i]))
            throw new Error('PTCL VM data differs at frame ' + frame);
          const reference = await render(source);
          atlas = reference.texture;
          const current = await render(browser, atlas);
          if (
            current.words.length !== 100 * 28 ||
            !current.words.every((word, i) => word === reference.words[i])
          )
            throw new Error('PTCL DrawUP words differ at frame ' + frame);
          pixels.push([reference.pixels, current.pixels]);
        }
        await raw.close();
        raw = null;
        taskMemory.unbind(rawID);
        await source.close();
        fresh = make();
        await fresh.restore(structuredClone(browser.snapshot()));
        return {
          loaded,
          dimensions: [bank.width, bank.height],
          ground,
          pixels,
          atlasDimensions: [atlas.width, atlas.height],
          restored: (await render(fresh, atlas)).pixels,
        };
      } finally {
        await raw?.close();
        taskMemory?.unbind(rawID);
        await fresh?.close();
        await browser.close();
        await source.close();
      }
    },
    [...files.keys()],
  );
  expect(result.loaded).toEqual({ control: 1, value: 1 });
  expect(result.dimensions).toEqual([21, 22]);
  expect(result.atlasDimensions).toEqual([32, 32]);
  for (const [native, web] of result.pixels) expect(web).toBe(native);
  const last = result.pixels.at(-1)[1];
  expect(last).not.toBe(result.ground);
  expect(result.restored).toBe(last);
});

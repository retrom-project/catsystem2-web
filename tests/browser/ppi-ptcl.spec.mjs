import { routeGraphicsOracle } from '../fixtures/oracle-browser-routes.mjs';
// SPDX-License-Identifier: MPL-2.0
import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { encodeHG2 } from '../../src/formats/hg2.mjs';
import { kcsProgram } from '../helpers.mjs';

for (const [label, profile] of [
  ['SDK', 'sdk-4.01-engine-2.6.1.74'],
  ['game', 'nekopara-vol3-engine-2.6.1.76'],
])
  test(`${label} loads the original SDK snow atlas and restores its pixels`, ({ page }) =>
    checkSnowScene(page, label, profile));

async function checkSnowScene(page, label, profile) {
  const sdk = process.env.CATSYSTEM2_SDK_EXE,
    exe = label === 'SDK' ? sdk : process.env.CATSYSTEM2_ENGINE_EXE,
    dll = process.env.CATSYSTEM2_EMOTE_DLL,
    assets = ['scene/spl2_ptc.cst', 'ptcl/snow.kcs', 'image/fg_snow.hg3'];
  test.skip(
    !exe ||
      !sdk ||
      (label === 'game' && !dll) ||
      !assets.every((path) => existsSync(resolve(dirname(sdk), path))),
  );
  test.setTimeout(180000);
  const files = new Map([
    ['engine.exe', await readFile(exe)],
    ...(label === 'game' ? [['emotedriver.dll', await readFile(dll)]] : []),
    ['main.kcs', kcsProgram([[37, 1024], [43, 0x47, 4], [59]])],
    ...(await Promise.all(
      assets.map(async (path) => [path, await readFile(resolve(dirname(sdk), path))]),
    )),
  ]);
  expect(assets.map((path) => createHash('sha256').update(files.get(path)).digest('hex'))).toEqual([
    'ccd9ff8be33d76b5a4707dce8dbed4d7c03ad5e41dcc5e06697dc0b1e48bddb8',
    '2aa8485f69abbbe046537582284284458400db577e02b3daf13013a740713bd6',
    'e017a3810b36b3ef510757ce7374e2e3dd74daa60df27f70b2fa75e24f74676c',
  ]);
  files.set(
    'image/asymmetric.hg2',
    await encodeHG2({
      width: 2,
      height: 2,
      rgba: new Uint8Array([255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 255, 255]),
    }),
  );
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
  await routeGraphicsOracle(page);
  await page.goto('/');
  const result = await page.evaluate(
    async ({ names, profile }) => {
      const { installGraphicsOracle } = await import('/tests/fixtures/graphics-oracle-world.mjs');
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
            profile,
            files,
            width,
            height,
            storage: { read: async () => null, write: async () => true },
          }),
        source = installGraphicsOracle(make()),
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
        const render = async (world) => {
          const gpu = world.stageRenderer.gpu,
            draw = gpu.drawGeometry,
            words = [];
          let texture;
          gpu.drawGeometry = function (geometry, image, options) {
            if (image.width > 1) {
              // The original renderer submits each strip as two triangles.
              // The browser submits the same vertices in one bank batch.
              const vertices = geometry.flatMap(({ vertices: quad }) =>
                quad.length === 4 ? [quad[0], quad[1], quad[2], quad[2], quad[1], quad[3]] : quad,
              );
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
        const snow = {
          program: 'ptcl/' + program + '.kcs',
          texture: 'image/' + texture + '.hg3',
          count: Number(count),
          priority: Number(priority),
          registers: registers.map(Number),
        };
        await source.getNativeFeature('engine-files');
        rawID = await source.objects.create({ kind: 16, parent: source.root });
        taskMemory = await source.getNativeFeature('task-memory');
        raw = await originalPTCLTask(
          source.nativeEngine,
          source.nativeEngine.features.get('graphics-platform').refs.view,
          {
            ...snow,
            id: source.nativeTaskID(rawID),
            bind: (pointer) =>
              taskMemory.bind(source.objects.objects.get(rawID), pointer, { ready: false }),
            texture: '',
          },
        );
        const task = await browser.objects.create({ kind: 16, parent: browser.root }),
          candidate = browser.particles.get(task),
          nativeID = browser.nativeTaskID(task),
          m = browser.main.machine,
          call = (id, args) => browser.runtime.native('main', id, args, m, browser.main);
        const load = (texture) => {
          m.writeString(texture, 256);
          return call(0x10f, [nativeID, 128, 256, snow.count, floatBits(snow.priority), 384]);
        };
        const fields = (atlas) => [
          Boolean(atlas.pointer),
          atlas.width,
          atlas.height,
          atlas.priority,
          atlas.near,
        ];
        const lifecycle = [];
        const compareAtlas = () => {
          const original = fields(raw.atlas()),
            current = fields(candidate.bank.nativeAtlas);
          if (!original.every((value, i) => Object.is(value, current[i])))
            throw new Error(`PTCL texture state differs: ${original} vs ${current}`);
          lifecycle.push(current);
        };
        m.writeString(snow.program, 128);
        snow.registers.forEach((value, i) => m.store(384 + i * 4, floatBits(value)));
        await load('');
        compareAtlas();
        await raw.reload(snow);
        const loaded = await load(snow.texture);
        compareAtlas();
        await raw.send(315);
        await call(0x110, [nativeID]);
        const bank = candidate.bank,
          pixels = [];
        let atlasDimensions;
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
          const reference = await render(source),
            current = await render(browser),
            atlas = reference.texture;
          if (
            atlas.width !== current.texture?.width ||
            atlas.height !== current.texture?.height ||
            !atlas.rgba.every((byte, i) => byte === current.texture.rgba[i])
          ) {
            const mismatch = atlas.rgba.findIndex((b, i) => b !== current.texture?.rgba[i]);
            throw new Error(
              'PTCL uploaded atlas differs at frame ' +
                frame +
                ' dimensions ' +
                [atlas.width, atlas.height, current.texture?.width, current.texture?.height] +
                ' max ' +
                Math.max(...atlas.rgba.map((b, i) => Math.abs(b - current.texture.rgba[i]))) +
                ' byte ' +
                mismatch +
                ' ref ' +
                [...atlas.rgba.slice(Math.max(0, mismatch - 4), mismatch + 8)] +
                ' JS ' +
                [...current.texture.rgba.slice(Math.max(0, mismatch - 4), mismatch + 8)],
            );
          }
          atlasDimensions = [atlas.width, atlas.height];
          const mismatch = current.words.findIndex((word, i) => word !== reference.words[i]);
          if (
            current.words.length !== 100 * 42 ||
            current.words.length !== reference.words.length ||
            mismatch !== -1
          )
            throw new Error(
              `PTCL DrawUP words differ at frame ${frame}: ${current.words.length}/${reference.words.length}, word ${mismatch}: ${current.words[mismatch]}/${reference.words[mismatch]}`,
            );
          pixels.push([reference.pixels, current.pixels]);
        }
        fresh = make();
        await fresh.restore(structuredClone(browser.snapshot()));
        const restoredBank = fresh.particles.get(task).bank,
          pointer = bank.nativeAtlas.pointer,
          d3d = (world) => world.nativeEngine.features.get('renderer').d3d;
        if (
          restoredBank.nativeAtlas.pointer !== pointer ||
          !fresh.particles.textures.owned.has(pointer)
        )
          throw new Error('Fresh PTCL atlas did not retain its JS surface owner');
        const restored = (await render(fresh)).pixels;
        for (const spec of [
          { texture: '', priority: 3000 },
          { texture: 'image/missing.hg3', priority: 4000 },
          { texture: snow.texture, priority: 1000, externalDraw: true },
        ]) {
          await raw.reload(spec);
          await candidate.load({ ...snow, family: 'script', ...spec });
          compareAtlas();
        }
        if (
          browser.particles.textures.owned.has(pointer) ||
          !fresh.particles.textures.owned.has(pointer)
        )
          throw new Error('PTCL reload leaked its old texture or released the fresh owner');
        const hg2 = { texture: 'image/asymmetric.hg2', priority: 6000 };
        await raw.reload(hg2);
        await candidate.load({ ...snow, family: 'script', ...hg2 });
        compareAtlas();
        const originalHG2 = d3d(source).frame(raw.atlas().pointer),
          currentHG2 = candidate.bank.image;
        if (
          originalHG2.width !== currentHG2.width ||
          originalHG2.height !== currentHG2.height ||
          !originalHG2.rgba.every((byte, i) => byte === currentHG2.rgba[i])
        )
          throw new Error('PTCL uploaded HG2 rows differ');
        return {
          loaded,
          dimensions: [bank.width, bank.height],
          ground,
          pixels,
          atlasDimensions,
          lifecycle,
          restored,
          hg2: [...currentHG2.rgba],
        };
      } finally {
        await raw?.close();
        taskMemory?.unbind(rawID);
        await fresh?.close();
        await browser.close();
        await source.close();
      }
    },
    { names: [...files.keys()], profile },
  );
  expect(result.loaded).toEqual({ control: 1, value: 1 });
  expect(result.dimensions).toEqual([21, 22]);
  expect(result.atlasDimensions).toEqual([32, 32]);
  expect(result.lifecycle).toEqual([
    [false, 0, 0, 0, 59000],
    [true, 21, 22, 5000, 59000],
    [false, 21, 22, 5000, 61000],
    [false, 256, 256, 4000, 60000],
    [false, 256, 256, 4000, 60000],
    [true, 2, 2, 6000, 58000],
  ]);
  expect(result.hg2).toEqual([0, 0, 255, 255, 0, 0, 255, 255, 255, 0, 0, 255, 255, 0, 0, 255]);
  for (const [native, web] of result.pixels) expect(web).toBe(native);
  const last = result.pixels.at(-1)[1];
  expect(last).not.toBe(result.ground);
  expect(result.restored).toBe(last);
}

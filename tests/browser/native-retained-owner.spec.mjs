// SPDX-License-Identifier: MPL-2.0
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { encodeHG2 } from '../../src/formats/hg2.mjs';
import { kcsProgram } from '../helpers.mjs';

for (const [contract, label] of [
  [
    'clear',
    'sparse native VRAM clears retain page identity, 16-bit conversion and fresh GPU state',
  ],
  ['upload', 'bounded native VRAM uploads preserve page dither and fresh GPU pixels'],
])
  for (const [profile, variable] of [
    ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
    ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
  ])
    test(`${profile} ${label}`, async ({ page }) => {
      test.skip(
        !process.env[variable] ||
          (!profile.startsWith('sdk-') && !process.env.CATSYSTEM2_EMOTE_DLL),
      );
      test.setTimeout(180000);
      const files = new Map([
        ['engine.exe', new Uint8Array(await readFile(process.env[variable]))],
        ['main.kcs', kcsProgram([[37, 1024], [43, 0xd1, 4], [43, 0x41, 0], [59]])],
      ]);
      if (!profile.startsWith('sdk-'))
        files.set(
          'emotedriver.dll',
          new Uint8Array(await readFile(process.env.CATSYSTEM2_EMOTE_DLL)),
        );
      await page.route(/\/tests\/fixtures\/texture-(clear|upload)-fixture\.mjs$/, async (route) => {
        const name = new URL(route.request().url()).pathname.split('/').pop();
        return route.fulfill({
          contentType: 'text/javascript',
          body: await readFile(new URL('../fixtures/' + name, import.meta.url)),
        });
      });
      await page.route('**/texture-clear-fixture/**', async (route) => {
        const name = decodeURIComponent(
            new URL(route.request().url()).pathname.slice('/texture-clear-fixture/'.length),
          ),
          bytes = files.get(name);
        await route.fulfill(bytes ? { body: Buffer.from(bytes) } : { status: 404, body: '' });
      });
      await page.goto('/');
      const result = await page.evaluate(
        async ({ profile, names, contract }) => {
          const [{ exerciseTextureClear }, { exerciseTextureUpload }, { StageRenderer }] =
              await Promise.all([
                import('/tests/fixtures/texture-clear-fixture.mjs'),
                import('/tests/fixtures/texture-upload-fixture.mjs'),
                import('/src/render/stage.mjs'),
              ]),
            files = new Map(
              await Promise.all(
                names.map(async (name) => [
                  name,
                  new Uint8Array(
                    await (
                      await fetch('/texture-clear-fixture/' + encodeURIComponent(name))
                    ).arrayBuffer(),
                  ),
                ]),
              ),
            );
          const exercise = contract === 'upload' ? exerciseTextureUpload : exerciseTextureClear;
          return exercise(profile, files, () => {
            const canvas = new OffscreenCanvas(16, 16);
            return new StageRenderer({
              canvas,
              ctx: canvas.getContext('2d'),
              begin() {
                this.ctx.reset();
              },
            });
          });
        },
        { profile, names: [...files.keys()], contract },
      );
      for (const [name, passed] of Object.entries(result)) expect(passed, name).toBe(true);
    });

for (const [profile, variable] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
])
  for (const mode of ['kcs', 'fes'])
    test(`${profile} ${mode} retained owner pixels and native references survive KCS release and fresh GPU restoration`, async ({
      page,
    }) => {
      test.skip(
        !process.env[variable] ||
          (!profile.startsWith('sdk-') && !process.env.CATSYSTEM2_EMOTE_DLL),
      );
      test.setTimeout(180000);
      const rgba = Uint8Array.from({ length: 4 * 3 * 4 }, (_, i) =>
          i % 4 === 3 ? 255 : ((i >>> 2) * 17 + (i % 4) * 53 + 11) & 255,
        ),
        files = new Map([
          ['engine.exe', new Uint8Array(await readFile(process.env[variable]))],
          ['main.kcs', kcsProgram([[37, 1024], [43, 0xd1, 4], [43, 0x41, 0], [59]])],
          [
            'owner.fes',
            new TextEncoder().encode(
              '#DEFINE\nDIFIMAGE face\n#OBJECT PRI DISP\nface 7 1\n#START\nnext WAIT\n#WAIT\n',
            ),
          ],
          ['@cat/image/panel.hg2', await encodeHG2({ width: 4, height: 3, rgba }, { crop: false })],
        ]);
      if (!profile.startsWith('sdk-'))
        files.set(
          'emotedriver.dll',
          new Uint8Array(await readFile(process.env.CATSYSTEM2_EMOTE_DLL)),
        );
      const planeFixture = await readFile(
        new URL('../fixtures/browser-native-world.mjs', import.meta.url),
      );
      await page.route('**/tests/fixtures/browser-native-world.mjs', (route) =>
        route.fulfill({ body: planeFixture, contentType: 'text/javascript' }),
      );
      await page.route('**/retained-owner-fixture/**', async (route) => {
        const name = decodeURIComponent(
            new URL(route.request().url()).pathname.slice('/retained-owner-fixture/'.length),
          ),
          bytes = files.get(name);
        await route.fulfill(bytes ? { body: Buffer.from(bytes) } : { status: 404, body: '' });
      });
      await page.goto('/');
      const result = await page.evaluate(
        async ({ profile, names, source, mode }) => {
          const [
              { NativeWorld },
              { NativeConfiguration },
              { MotionLibrary },
              { ParticleRandom },
              { StageRenderer },
              { placeBrowserNativePlane },
              { floatBits },
            ] = await Promise.all([
              import('/web/transitional-entry.mjs'),
              import('/src/native/config.mjs'),
              import('/src/motion/library.mjs'),
              import('/src/ppi/random.mjs'),
              import('/src/render/stage.mjs'),
              import('/tests/fixtures/browser-native-world.mjs'),
              import('/src/kcs.mjs'),
            ]),
            files = new Map(
              await Promise.all(
                names.map(async (name) => [
                  name,
                  new Uint8Array(
                    await (
                      await fetch('/retained-owner-fixture/' + encodeURIComponent(name))
                    ).arrayBuffer(),
                  ),
                ]),
              ),
            ),
            worlds = [],
            make = () => {
              const canvas = new OffscreenCanvas(64, 48),
                stageRenderer = new StageRenderer({
                  canvas,
                  ctx: canvas.getContext('2d'),
                  begin() {
                    this.ctx.reset();
                  },
                }),
                game = {
                  width: 64,
                  height: 48,
                  index: new Map(names.map((name) => [name, {}])),
                  names: (ext) => names.filter((name) => name.endsWith('.' + ext)),
                  has: (name) => files.has(name.toLowerCase()),
                  read: async (name) => files.get(name.toLowerCase()) ?? null,
                  async require(name) {
                    const bytes = await this.read(name);
                    if (bytes === null) throw new Error('Missing ' + name);
                    return bytes;
                  },
                  resolveCategory(name, category) {
                    const path = this.has(name) ? name : `@cat/${category}/${name}`;
                    return this.has(path) ? path : null;
                  },
                  readCategory(name, category) {
                    return this.read(this.resolveCategory(name, category));
                  },
                },
                configuration = new NativeConfiguration({ profile }),
                random = new ParticleRandom();
              Object.assign(configuration.screen, {
                width: 64,
                height: 48,
                currentWidth: 64,
                currentHeight: 48,
                virtualWidth: 64,
                virtualHeight: 48,
              });
              configuration.fields.texture.size.set([64, 64]);
              configuration.fields.texture.grid.set([1, 1]);
              configuration.fields.texture.bppY.set([1, 1]);
              configuration.fields.texture.areas[0].set([0, 0, 1, 1]);
              const world = new NativeWorld({
                game,
                profile,
                images: {},
                host: {},
                configuration,
                random,
                motionLibrary: new MotionLibrary(game, { profile, random }),
                storage: { read: async () => null, write: async () => true },
              });
              world.stageRenderer = stageRenderer;
              worlds.push(world);
              return world;
            },
            render = (world) =>
              world.stageRenderer.render(world.graphics.stage, null, world.particles.drawItems()),
            pixels = (world) => Array.from(world.stageRenderer.gpu.pixels()),
            world = make();
          try {
            await world.initialize('main.kcs');
            const task = world.main,
              m = task.machine,
              call = (id, args) => world.runtime.native('main', id, args, m, task),
              id = await world.objects.create({
                kind: 15,
                parent: task.id,
                name: 'Authored retained surface',
              }),
              nativeID = world.nativeTaskID(id),
              draw = world.graphics.drawTasks.get(id);
            await call(0x100, [nativeID, 8, 6]);
            await call(0x104, [nativeID, 0, 0]);
            m.writeString('panel.hg2', 256);
            const handle = (await call(0x2c6, [256])).value,
              owners = await world.getNativeFeature('image-owners'),
              pointer = owners.pointer(handle),
              p = world.nativeEngine.process;
            let fesID;
            if (mode === 'fes') {
              fesID = await world.objects.create({
                kind: 34,
                parent: task.id,
                name: 'Authored external image',
              });
              const fes = world.objects.objects.get(fesID).implementation;
              fes.surface = id;
              await fes.load('owner.fes', task);
              const object = fes.player.root.byKey.get('face');
              await world.imagesFES.command(fes.player.root, object, 'refex', [String(handle)]);
              await world.imagesFES.command(fes.player.root, object, 'pos', ['1', '1']);
              await fes.tick();
            } else
              await call(0x2db, [
                nativeID,
                7,
                handle,
                ...[1, 1, 0, 0, 0, 1, 1].map(floatBits),
                255,
                1,
                0,
              ]);
            await call(0x154, [nativeID]);
            const planeID = await world.objects.create({
              kind: 2,
              parent: world.root,
              name: 'Authored uploaded surface',
            });
            await placeBrowserNativePlane(world, planeID, {
              width: 8,
              height: 6,
              priority: 1000,
              position: [0, 6, 0],
              scale: [1, -1, 1],
            });
            await render(world);
            const first = pixels(world),
              cpu = Array.from(
                await world.graphics.images.get(draw.state.renderer.bitmap).pixels(),
              ),
              visibleColors = source
                .filter((_, i) => i % 4 === 0)
                .map((_, i) => {
                  const color = source.slice(i * 4, i * 4 + 4);
                  let count = 0;
                  for (let at = 0; at < first.length; at += 4)
                    if (color.every((value, j) => value === first[at + j])) count++;
                  return count;
                });
            await call(0x2c7, [handle]);
            const retainedReference = p.load(pointer);
            await render(world);
            const afterRelease = pixels(world),
              fresh = make();
            await fresh.restore(structuredClone(world.snapshot()));
            await render(fresh);
            const restored = pixels(fresh),
              fp = fresh.nativeEngine.process,
              restoredReference = fp.load(pointer),
              restoredDraw = fresh.graphics.drawTasks.get(id),
              restoredCPU = Array.from(
                await fresh.graphics.images.get(restoredDraw.state.renderer.bitmap).pixels(),
              );
            if (mode === 'fes') {
              const fes = fresh.objects.objects.get(fesID).implementation,
                object = fes.player.root.byKey.get('face');
              await fresh.imagesFES.command(fes.player.root, object, 'delete', []);
              await fresh.imagesFES.close(object);
            } else
              await fresh.runtime.native(
                'main',
                0x102,
                [nativeID, 7],
                fresh.main.machine,
                fresh.main,
              );
            await render(fresh);
            return {
              visibleColors,
              first,
              afterRelease,
              restored,
              cpu,
              restoredCPU,
              retainedReference,
              restoredReference,
              freed: !fp.allocations.has(pointer),
              originalAlive: p.allocations.has(pointer),
              removed: pixels(fresh),
              errors: worlds.map((w) => w.stageRenderer.gpu.gl.getError()),
            };
          } finally {
            for (const world of worlds.toReversed()) await world.close({ flushFiles: false });
          }
        },
        { profile, names: [...files.keys()], source: [...rgba], mode },
      );
      expect(
        result.visibleColors,
        JSON.stringify({
          cpu: result.cpu,
          colored: result.first
            .flatMap((_, i) =>
              i % 4 === 0 && result.first.slice(i, i + 3).some(Boolean)
                ? [[i / 4, ...result.first.slice(i, i + 4)]]
                : [],
            )
            .slice(0, 24),
        }),
      ).toEqual(new Array(12).fill(1));
      expect(result.afterRelease).toEqual(result.first);
      expect(result.restored).toEqual(result.first);
      expect(result.restoredCPU).toEqual(result.cpu);
      expect(result.retainedReference).toBe(mode === 'fes' ? 2 : 1);
      expect(result.restoredReference).toBe(mode === 'fes' ? 2 : 1);
      expect(result.freed).toBe(true);
      expect(result.originalAlive).toBe(true);
      expect(result.removed.every((value, i) => value === (i % 4 === 3 ? 255 : 0))).toBe(true);
      expect(result.errors).toEqual([0, 0]);
    });
